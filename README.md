# GTO Trainer

A web-based postflop GTO trainer. A local open-source solver precomputes
strategies into SQLite, and a Next.js/React interface cycles through the stored
spots and grades your picks against the GTO frequencies (mixed-strategy scoring).

## How it works

```
TexasSolver (offline)          build pipeline               Next.js app
┌────────────────────┐   ┌───────────────────────┐   ┌───────────────────────┐
│ console_solver.exe │ → │ scripts/*.mjs         │ → │ /api/session          │
│ output_result.json │   │ data/gto.db (SQLite)  │   │ /api/answer           │
└────────────────────┘   └───────────────────────┘   │ React trainer UI      │
                                                      └───────────────────────┘
```

- **Solver:** [TexasSolver](https://github.com/bupticybee/TexasSolver) v0.2.0
  (C++ console). Used **offline only**; not redistributed or served.
- **Spots:** heads-up single-raised-pot postflop spots (SB vs BB and BTN vs BB)
  on the turn and river.
- **Database:** SQLite via Node's built-in `node:sqlite` (no native build).
- **App:** Next.js 16 (App Router) + React 19 + Tailwind v4.

## Requirements

- Node.js 22+ (developed on 23.11). No other toolchain needed: the solver is a
  prebuilt **x86-64** console binary, so on an x64 host (Windows/Linux/macOS) it
  runs natively. On ARM64 it runs under emulation (e.g. Windows 11 Prism).
- PowerShell users: call `npm.cmd` if `npm.ps1` is blocked by execution policy.

## Setup

```powershell
npm install
npm run solver:setup   # download the solver for this OS/arch (once)
npm run data:build     # generate inputs -> solve -> load SQLite
npm run dev
```

`npm run solver:setup` detects `process.platform`/`process.arch` and unpacks the
matching TexasSolver release into `solver/texassolver/` (gitignored). Re-run with
`npm run solver:setup -- --force` to refresh it.

Open http://localhost:3000.

### Data pipeline commands

| Command               | Does                                                      |
| --------------------- | --------------------------------------------------------- |
| `npm run solver:setup`| Downloads/unpacks the solver for this OS/arch             |
| `npm run data:gen`    | Writes solver inputs to `data/inputs/*.txt`               |
| `npm run data:solve`  | Runs the solver, writes `data/raw/*.json` + logs          |
| `npm run data:load`   | Parses raw output and rebuilds `data/gto.db`              |
| `npm run data:build`  | gen + solve + load, in order                              |
| `npm run data:preflop`| Regenerates `data/preflop/` (preflop charts + index)      |
| `npm run import:solve`| Imports one or more raw JSON trees into `data/gto.db`      |

Spot definitions, ranges, per-position betting options, and preflop history live
in `scripts/spots.config.mjs`. Add a spot there and re-run `npm run data:build`
to include it.

### Importing a raw tree by hand

`scripts/import-solve.js` loads a TexasSolver dump straight into the database.
It replaces any previous import of the same file (matched on `source_file`), so
re-running it is safe:

```bash
node scripts/import-solve.js data/raw/sb_bb_river_As7h2c9d3s.json
node scripts/import-solve.js data/raw/*.json --pot 5.5 --stack 97.5
```

`--pot`/`--stack` are only needed when the input file that produced the JSON is
gone; when `data/inputs/<stem>.txt` exists the values are read from it. The
importer dedupes identical trees by `(positions, board, pot, stack)` and skips
trees whose config changed.

`scripts/run-and-import.js` wraps "solve one input, then import the result" and
is what the on-demand solver calls:

```bash
node scripts/run-and-import.js                       # every input in data/inputs
node scripts/run-and-import.js --only sb_bb_turn      # just the matching inputs
node scripts/run-and-import.js --import-only          # reuse data/raw/*.json
node scripts/run-and-import.js --force --timeout 600  # re-solve, 10 min deadline
```

Solver output is streamed to `data/raw/<stem>.log` while it runs, and iteration
progress is echoed to the job log. Every solve has a deadline (default 1800s,
`--timeout 0` disables it): a solver that runs out of memory stops printing
iterations and never exits, so the deadline is what turns that into a failed job
instead of a job that stays "running" forever.

## Solve a spot on demand

Open the app's **Solve viewer** (`/`). It always starts at the preflop root, with
**UTG** to act (6-max order: UTG → MP → CO → BTN → SB → BB). The preflop chart
is walked in the same trail UI as the postflop streets: click a branch, the next
seat's options replace it. Seats that fold are part of the path — the chart
omits the folds it considers automatic, so `lib/preflop-tree.ts` re-expands every
line into a full action sequence and folds those sequences into one trie
(`GET /api/preflop/tree?path=…`).

When the line closes preflop, the viewer asks for the **flop cards** — pick three
and press *Solve*. Lines that do not reach a solvable flop (three-way, or all-in
preflop) say why instead.

The branches are exactly the ones the bundled chart solved. That chart is
3-bet-or-fold for MP/CO facing an open (only BTN and BB have cold calls), so a
`Call` branch is intentionally absent there rather than missing from the UI.

Then:

1. `POST /api/solve` writes the solver input to `data/inputs/<stem>.txt` and
   returns a job id immediately. A previously solved spot with the same line +
   board is returned as `cached`.
2. The solver runs as a child process and its output is streamed to the job log.
3. When it finishes, `scripts/run-and-import.js` imports the tree into
   `data/gto.db` and the viewer opens the spot. Its trail shows the preflop
   decisions you clicked, followed by the postflop streets — clicking a preflop
   step jumps back into the chart there.

`/solve` redirects to the viewer; the preflop dropdown it used to have is gone.

### Spot identity

`data/inputs/<stem>.txt`, `data/raw/<stem>.json` and `spots.source_file` are all
keyed by the stem `<oop>_<ip>_<street>_<board>_<id>`. `id` is a short hash of
what actually defines the tree — the preflop line (pot and stack included), or,
for a continuation, the parent spot + the node dealt from + the card. Without
it, the same seats and flop from two different preflop lines (or two different
postflop nodes) share a filename, and importing the second tree deletes the
first one's row.

A flop solve builds the whole three-street tree, so `lib/solver-input.ts` keeps
it small: one bet size per street (33 % flop, 75 % turn/river) and an all-in only
on the river when the SPR is 6 or less. Two sizes per street push a deep-stack
flop tree past 20 GB and the solver dies — turn and river solves have fewer
streets left, fit easily, and keep both sizes plus all-in. Solves run with 18
solver threads (`set_thread_num 18`). Set `GTO_SOLVE_TIMEOUT_SEC` to change the
job deadline.

The tree is only dumped for the starting street (`set_dump_rounds 1`), matching
the rest of the database. Job state lives in memory in the dev server, so
restarting `npm run dev` clears pending jobs (already imported spots are kept).

### Deal the next card

Only the starting street is dumped, so every action that closes the betting
round points at an empty chance node. In the viewer, those actions are marked
**+card**: click one and the app asks which card to deal. The card starts a new
tree for the ranges that actually reach that point:

```
reach(side, hand) = product of that side's action frequencies along the path
pot               = pot + 2 × (chips each player put in on that street)
effective stack   = stack − chips put in on that street
```

The dealt card **extends** the trail instead of replacing it: the viewer fetches
the chain of ancestor spots (`GET /api/spots/<id>/ancestors`) and renders

```
preflop decisions → flop cards → flop decisions → turn card → turn decisions → river card → river decisions
```

Each continuation is linked to its parent by `spots.parent_spot_id`,
`parent_path` (the chance node it was dealt at) and `dealt_card`, written by the
job after the import. Clicking any earlier step switches back to that spot and
node, so the whole hand stays navigable.

Every card is its own tree (own board, own solve), so you can deal `9d`, look
at it, and then deal `3c` instead — the picker stays open and marks the cards
that are already solved with a check mark; clicking a solved card opens it
without re-solving.

`lib/continuation.ts` does the derivation, `GET /api/continuation?spotId=N&path=P`
returns the card picker state (blocked cards, already-solved cards) and
`POST /api/continuation` with `{ spotId, path, card }` starts the job. `path` is
the chance node's action path from `node_actions` (e.g. `x-b2-c`), so any
end-of-street node can be continued, not just "call the first bet".

The solve list in the viewer is grouped by preflop decision and flop: the
preflop tree gives exactly one line per (OOP, IP, pot) so each spot's line is
derived from its own metadata, and a turn/river spot inherits the line of the
spot it was continued from.

Ranges are carried over per hand *class* — the solver's input format only
understands `AA`/`AKs`/`AKo` and rejects suit-specific combos — so a class takes
the mean frequency of its combos that are still possible (combos using a board
card are dropped). Total range mass is preserved; suit-level blocker detail is
averaged away between streets.

## Training

1. Pick matchups, streets, and a question count.
2. For each spot you see the **preflop hand history** (how the pot was built),
   the board, your hole cards, your position, pot and effective stack, the
   per-position **betting options**, and the legal actions.
3. After you pick, the GTO frequency for every action is shown. Your score is
   the frequency of the action you chose, so mixed spots award partial credit.
4. A session alternates OOP and IP questions; the summary reviews every hand.

### Betting options

Each spot configures the bet/raise sizes the solver tree uses, per street and
per position (`defaultBetSizes` + optional per-spot `betSizes` in
`scripts/spots.config.mjs`). More sizes make the tree larger and the solve
slower, so keep the list lean. The resolved sizes are stored with the spot and
shown in the trainer.

## Solver notes

- `npm run solver:setup` detects your OS/arch and unpacks the matching binary
  to `solver/texassolver/` (gitignored). The v0.2.0 release ships x86-64 builds
  for Windows, Linux, and macOS, so x64 hosts run it natively.
- Player mapping in solver output: **player 1 = OOP, player 0 = IP**.
- The pipeline dumps only the starting street (`set_dump_rounds 1`) to keep the
  MVP database small; the solve still runs turn and river internally, and
  `lib/continuation.ts` re-solves the next street from the ranges that reach a
  call instead of dumping the whole tree.
- License: TexasSolver is **AGPL v3** and is used locally for personal study
  only. See `solver/README.md`.

### Fallback (ARM64)

There is no native ARM64 build. On an ARM64 host the x64 binary runs under
emulation (e.g. Windows 11 Prism). If that is too slow or unavailable, install
an ARM64 JRE and use
[TexasHoldemSolverJava](https://github.com/bupticybee/TexasHoldemSolverJava)
(MIT), which produces the same output JSON format.

## Layout

```
app/            Next.js routes (/, /solve, /api/preflop, /api/solve, /api/continuation, /api/spots)
components/     React trainer UI (Trainer, SolveSpot, Viewer)
lib/            db access, types, cards, grading, solver input + continuation + preflop chart tree
scripts/        spot config + build pipeline + raw-tree importers
solver/         downloaded solver binary (gitignored)
data/           generated inputs/raw JSON/gto.db (gitignored)
```
