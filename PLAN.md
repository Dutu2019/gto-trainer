# PLAN — Preflop Range Pipeline + Spot Studier

Two features to add on top of the existing trainer:

1. **Preflop data pipeline** — solve 6-max preflop spots offline with TexasSolver,
   store the resulting per-seat ranges (and the strategies that produced them)
   in the database. Generate random streets and run the solver from the flop to
   the end of the hand, storing the decision trees and player ranges.
2. **Spot Studier page (`/study`)** — pick a preflop line, see the action
   sequence, click any player's decision to inspect the decision tree and all
   six players' ranges at that point, input a flop, and solve flop → turn →
   river street by street. Every computed tree is persisted for future drills.

The existing trainer (`/`, `/api/session`, `/api/answer`, `components/TrainerApp*`)
stays untouched; both features are additive.

---

## 0. Solver facts already verified (spike results)

These were confirmed by running `solver/texassolver/console_solver.exe` directly
and matter for every design decision below:

| Fact | Consequence |
| --- | --- |
| Solver is **2-player only** (OOP = `player 1`, IP = `player 0`) | Every preflop sub-spot must be modeled as a heads-up solve between the two live players; folded seats are scripted folds that only contribute dead money to the pot. The studier only supports lines that end **heads-up**. |
| `set_range` accepts **hand-class labels only** (`AA`, `AKs`, `AKo`, …). Explicit combos (`AsKs`) are rejected: `range str AsKs len not valid`. | Ranges carried between streets must be converted back into label strings. |
| Weights in ranges (`AKs:0.5`) are **silently ignored** — byte-identical output vs the unweighted range. | A hand class is either fully in or fully out of a range. Where GTO mixes (e.g. 50 % bet / 50 % check), we **round to the majority action** when carrying ranges forward, and document the approximation in the UI. |
| With `set_dump_rounds 1`, the dumped tree is **pruned after the first street** (`chance_node`s have no `dealcards`). | To get turn/river strategies we must solve each street as its own spot with the carried ranges — which is exactly the studier's flow anyway. |
| Dump node shape: `action_node { actions: ["CHECK","BET 2.000000",...], player, strategy.strategy: {combo: [freq]}, childrens }`, `chance_node { deal_number, dealcards }`. Terminals are simply absent. | One parser (`lib/solver-output.ts`) serves both the trainer loader and the studier API. |
| Current config: `threadNum 8`, `accuracy 0.5` (exploitability 0.5 %), `maxIteration 120`, `allinThreshold 0.67`, `useIsomorphism 1`. | Reused verbatim for all new spots. |

### Chosen sizing ladder (per the spec)

- **Preflop:** every raise is **2.5× the previous raise** → open 2.5bb,
  3-bet 6.25bb, 4-bet 15.625bb, 5-bet 39.06bb. (Beyond that the
  `allinThreshold 0.67` rule turns big raises into shove/call-or-fold.)
- **Postflop:** bets **25 % / 50 % pot**, raises **60 % / 100 % pot**,
  all-in always available. Stacks 100bb, exploitability 0.5 %.

---

## Phase 1 — Preflop range pipeline (data side)

**Goal:** for a set of canonical 6-max preflop lines, produce and store:
(a) every seat's range at every decision point, (b) the solver strategy that
justifies it, and (c) the flop pot / stack state after each line. Then generate
random flops and solve them, storing flop decision trees + starting ranges.

### 1.1 Spike: preflop tree support in the console solver *(do first, ~½ day)*

Before committing to the line-tree design, verify with tiny inputs that the
solver can express preflop spots:

- a root node with **FOLD** available to the opener (RFI: OOP = opener with
  full 1326 range, IP = defender);
- `CALL` / `RAISE` naming and `set_bet_sizes …,preflop?…` — find out how the
  input file expresses preflop raise sizes (fallback: model preflop raises as
  `set_pot` arithmetic + a first "street" of fixed-size bets, or check the
  solver's own preflop examples in `solver/README.md`);
- pot accounting with **dead money** (e.g. UTG 2.5 + MP call 2.5 + CO fold +
  BTN 3bet 6.25 …): confirm `set_pot` only sets the *starting* pot and raise
  sizes are absolute-to amounts.

*Outcome:* a short `docs/solver-preflop-notes.md` (or comments in the config)
recording the exact input format for preflop solves. If the solver cannot
express a preflop raise tree at all, fall back to modeling each preflop raise
as the first bet of a "flop-like" street with a 0-card board — decide in the
spike, not later.

### 1.2 `scripts/preflop.config.mjs` — 6-max line tree definition

New config module (sibling of `spots.config.mjs`) containing:

- `SEATS = ["UTG","MP","CO","BTN","SB","BB"]` and postflop acting order
  (`SB, BB, UTG, MP, CO, BTN`) — this defines who is OOP on the flop for any
  heads-up ending.
- `RAISE_LADDER = [2.5, 6.25, 15.625, 39.06]` (each 2.5× the previous) and the
  100bb stack.
- A declarative **line tree**: for each opening position (UTG, MP, CO, BTN, SB)
  the scripted folds of the seats that get out of the way, and which seat is
  the first "responder" the opener is solved against. Recursion happens at
  runtime (1.4), the config only declares:
  - `openers`: which seats open 2.5x (SB opens to 2.5 total as well, per spec).
  - `responders`: for each opener, the ordered list of seats that act next
    (e.g. `UTG → MP → CO → BTN → SB → BB`).
  - a depth cap (stop re-raising after the 4-bet; bigger raises resolve to
    all-in/fold through the solver's own all-in handling).
- Which lines are "kept": only lines that end **heads-up** (all other seats
  folded). Lines that end 3-way are recorded but flagged `multiway: true` and
  excluded from street generation and the studier (solver limitation).

### 1.3 `scripts/ranges.mjs` — rounding + range math (shared later with the app)

- `parseStrategy(node)` → `{ comboFreqs }` from a dump node.
- `roundNodeStrategy(node)` → per-action **label sets**:
  for each hand class (`AKs` = 4 combos, `AKo` = 12 …) aggregate its combos'
  frequencies per action and take the argmax. Output:
  - `ranges: Record<action, string[]>` — label lists ready for `set_range`;
  - `frequencies: Record<handClass, number[]>` — exact label-level frequencies
    for UI display (no rounding).
- `mergeRanges(a, b)` / `removeHands(range, folded)` helpers for carrying a
  player's range through their own actions (fold removes the class; call keeps
  the call-rounding; raise keeps the raise-rounding).
- Unit-testable pure functions (a tiny `node --test` file is enough; no test
  framework to add).

### 1.4 `scripts/preflop-solve.mjs` — the line-tree walker

Recursive solver driver. State at a node:

```
{ actor, history: SeatAction[], pot (bb), currentRaise (bb-to amount),
  ranges: { seat → label[] | "FOLDED" }, live: [seatA, seatB] }
```

Algorithm per acting node:

1. Build a solver input: OOP/IP = the two live players in preflop acting
   order, ranges from state, `set_pot` = pot including dead money, tree with
   FOLD / CALL / RAISE(ladder) / ALLIN available to the actor.
2. Run the solver (reuse `run-solver.mjs`'s spawn + `output_result.json`
   handling; factor the shared bits into `scripts/solver-run.mjs`).
3. Parse + round the actor's strategy (1.3).
4. Emit one child node per action:
   - **fold** → actor becomes `FOLDED`; if only one live player remains and the
     hand was not yet 3-way → line ends (heads-up flop spot recorded);
     otherwise remove the actor from the acting order and continue with the
     next seat.
   - **call** → pot += call amount; if this closes preflop action and exactly
     two players remain → **flop spot recorded** (pot, OOP/IP seats, ranges).
   - **raise** → pot += raise increment, new ladder level, child node with the
     same other live player as opponent (their range is still "full" until
     their first decision).
5. Depth/recursion guards: cap raise level, cap line count
   (e.g. first ~40–60 lines), skip degenerate branches (5-bet folds).

Output artifacts: `data/preflop/<lineId>.json` — full node tree with strategies
and per-seat ranges, plus the derived flop spots.

### 1.5 Random street generation — `scripts/generate-streets.mjs`

- For every recorded heads-up flop spot from 1.4, generate **2–3 random flops**
  (any 3 cards; no hole cards exist yet so there is nothing to exclude).
- Build flop solver inputs: pot + stacks from the line, OOP/IP ranges from the
  line, postflop sizes 25/50 bet, 60/100 raise, all-in, all three streets
  configured (solver needs the downstream tree even if we dump one round).
- Solve with `set_dump_rounds 1` → store `data/raw/preflop/<flopId>.json`.
  The solver still runs flop→turn→river internally; we store the flop tree.
  Turn/river trees are produced on demand by the studier (Phase 2) and
  persisted there, keeping the precomputed DB small.

### 1.6 Load to DB — extend `scripts/load-db.mjs`

New tables in `data/gto.db` (or a second `data/study.db`; same file is simpler):

```sql
preflop_lines    (id, actions_json, seats_json, oop_seat, ip_seat, pot, stack, kept)
preflop_nodes    (line_id, path, actor, street='preflop', strategy_json, ranges_json)
study_spots      (id, hash, kind='flop'|'turn'|'river', line_id, path, board,
                  oop_seat, ip_seat, pot, stack, ranges_json, tree_json, created_at)
```

`preflop_nodes` keeps **every seat's decision** (including the 2.5x/6.25x
raise strategies) so the studier can display "click any player's decision →
tree + ranges" for preflop too. `study_spots` is written by the studier API in
Phase 2 (hash = line + path + board + config so repeat visits are instant).

### 1.7 Wire-up + docs

- `package.json`: `preflop:gen`, `preflop:solve`, `preflop:load`,
  `preflop:build` (+ `streets:gen` folded into `preflop:build`).
- README section for the new pipeline (done again after Phase 2).

**Phase 1 acceptance:** `npm run preflop:build` produces a DB where
`preflop_lines` has ≥ 20 heads-up lines with all six seats' ranges and ≥ 40
solved flop spots; spot-check one line (e.g. "UTG opens, MP 3bets, UTG calls,
folds to BB who calls") against known 6-max ranges as a sanity check.

---

## Phase 2 — Spot Studier page (`/study`)

**Goal:** interactive UI per the spec: preflop action sequence top-right
(clickable per player decision), decision tree + six players' ranges at the
selected node, then flop input → solver run → tree/ranges → turn → river.
Colors: **red = raises, green = calls/checks, blue = folds**.

### 2.1 Shared types + parsing — `lib/study.ts`, `lib/solver-output.ts`

- `LineSummary`, `PreflopNode`, `SolutionTree`, `SolutionNode`, `RangeGrid`
  types shared by API routes and client.
- `parseDumpJson(raw)` → `SolutionTree` (action nodes with per-action
  aggregate frequency = sum over combos of freq × combo count, per-hand-class
  frequency table, children; chance nodes only matter for turn/river solves
  which are single-street dumps).
- `rangesAtNode(tree, path)` → `{ seat → { label → freqPct } }` used to draw
  the range grids (exact frequencies, not rounded).

### 2.2 API routes

- `GET /api/study/lines` — kept heads-up preflop lines from `preflop_lines`
  (id, action sequence, pot, OOP/IP seats).
- `GET /api/study/line/[id]` — full preflop node tree + per-seat ranges for
  the sequence bar and preflop decision inspection.
- `POST /api/study/solve` — body `{ lineId, path (chosen preflop node), board:
  { flop, turn?, river? } }`:
  1. Resolve the flop spot for `lineId`/`path` (pot, seats, ranges) — reject
     non-heads-up paths with a clear error.
  2. Derive the **carried ranges** for IP/OOP at the chosen node via argmax
     rounding (1.3 logic reused in `lib/ranges.ts`).
  3. Look up `study_spots` by hash; on miss, spawn the solver synchronously
     (reuse `scripts/solver-run.mjs`), parse, and persist.
  4. Return `{ tree, ranges, board, pot, stack, cached: boolean }`.
  Turn/river solves repeat with the next card and the previous node's ranges.
- Long solves (flop trees can take minutes): the route streams nothing fancy —
  client shows a progress state; optionally a `POST /api/study/solve/status`
  polling endpoint if the first build proves too slow. Keep the naive
  synchronous version as step 1, add polling only if needed.

### 2.3 UI — new components + `/study` page

`app/study/page.tsx` → `components/study/StudyApp.tsx`, a small state machine:

```
pickLine → inspectPreflop(nodes) → pickFlop → solving → flopResult
        → pickTurnNode → pickTurnCard → turnResult → pickRiverCard → riverResult
```

Components (all under `components/study/`):

- **`ActionSequenceBar.tsx`** *(top right)* — chips for every preflop action
  ("UTG 2.5x", "MP fold", "BTN 6.25x"…) and postflop actions ("OOP bet 25 %",
  "IP call"); each chip clickable → selects that node. Chip color: red raise,
  green call/check, blue fold. Current node highlighted.
- **`DecisionTree.tsx`** — the solver tree for the current street: nodes as
  boxes (actor + action + aggregate GTO frequency + pot/stack), children
  expandable/collapsible. Each action labeled with its exact aggregate
  frequency (e.g. "bet 25 % — 62 %"). Selecting a leaf-node path updates the
  range panels and is what the next street solve branches from.
- **`RangeGrid.tsx`** — 13×13 matrix per player (like the example images):
  rows = higher rank, columns = lower rank, upper-right triangle = suited,
  lower-left = offsuit, diagonal = pairs. Cell color = dominant action
  (red/green/blue), opacity/text = frequency %. Hover tooltip with per-action
  breakdown. Legend chips for the six seats; folded seats render dimmed
  "folded" placeholders so all six players are always visible.
- **`CardPicker.tsx`** — 52-card grid for flop (pick exactly 3), then turn,
  then river; disables used cards; reuses `lib/cards.ts`.
- **`BoardStrip.tsx`** — current board using the existing `Card` component.
- **`SolveStatus.tsx`** — spinner + "solving flop (exploitability target 0.5 %)…
  this can take a few minutes".

Layout: left = decision tree + range grids (two columns, one per live player,
with the four folded seats in a collapsed strip); top-right = action sequence
bar + board strip; bottom = card picker only when a card is needed.

### 2.4 Color/action mapping — `lib/study-actions.ts`

Single mapping table used by every component:

| action | color | chip style |
| --- | --- | --- |
| raise / bet-raise / all-in raise | red | filled red |
| call / check | green | filled green |
| fold | blue | filled blue |
| all-in shove (uncalled/terminal) | red outline | — |

### 2.5 Persistence of computed trees

Every flop/turn/river solve (user-triggered) is written to `study_spots` with
its full tree + ranges, keyed by hash. A small `GET /api/study/solution/[hash]`
lets the client reuse cached trees on revisit. These rows are the seed for
future drills (next phase).

### 2.6 README + polish

- Update README: new pipeline commands, `/study` description, solver facts
  (2-player, label-only ranges, rounding caveat).
- ESLint pass on the new files; keep the existing component style (Tailwind,
  small presentational components).

**Phase 2 acceptance:** pick "UTG open → MP 3bet → UTG call → folds → BB call"
(or any kept line), see the sequence bar, click "BTN fold" and see the tree +
six range grids; input a flop, get the solved tree with frequencies; click
"OOP bet 25 %", input a turn card, get the turn tree; same for river. Re-solving
a visited spot is instant (cache hit). Colors match the spec.

---

## Phase 3 — Follow-ups (explicitly out of scope for the first build)

- **Drills from studied spots:** extend `/api/session` to draw questions from
  `study_spots` (flop/turn/river trees) so the existing trainer can drill the
  spots the user studied.
- **Solver-run polling/queue** if flop solves prove too slow for a
  synchronous request (spawn as background job + status endpoint).
- **More lines / deeper ladder**, multiway handling if the solver ever gains
  multi-player support, and range-merging refinements beyond argmax rounding
  (e.g. storing combo-level strategies in the UI while rounding only for
  re-solving).

---

## Suggested work order

| # | Step | Depends on |
| --- | --- | --- |
| 1 | 1.1 solver preflop spike | — |
| 2 | 1.3 ranges/rounding module | — |
| 3 | 1.2 preflop config | 1 |
| 4 | 1.4 line-tree walker | 1,2,3 |
| 5 | 1.5 random flop generation | 4 |
| 6 | 1.6 DB load + 1.7 scripts | 4,5 |
| 7 | 2.1 types/parser | — (can start anytime) |
| 8 | 2.2 API routes | 6,7 |
| 9 | 2.3 UI components | 7,8 |
| 10 | 2.4 colors + 2.5 persistence | 8,9 |
| 11 | 2.6 README + polish | all |

Steps 2 and 7 are independent of the solver and can be built in parallel with
the Phase 1 solver work.
