# GTO Trainer — Build Plan

Web-based postflop GTO trainer. Next.js (App Router, TypeScript) front end, an
open-source solver used **offline** to precompute strategies into SQLite, and a
React training interface that cycles through positions and grades answers.

## Confirmed decisions

- **Solver:** TexasSolver C++ console (prebuilt x64 Windows release), with
  TexasHoldemSolverJava as fallback if ARM64 emulation fails.
- **Scope:** River + turn MVP (3–5 river spots + 2–3 turn spots).
- **Matchups:** SB vs BB and BTN vs BB, heads-up postflop only.
- **Grading:** Mixed-strategy scoring — score = GTO frequency of the chosen
  action (partial credit for genuinely mixed spots).

## Environment notes

- Windows 11 **ARM64** (Qualcomm), Node 23.11 (arm64), Python 3.14, git.
- No Java, Rust, CMake, or MSVC installed.
- Use `npm.cmd` / `npx.cmd` (PowerShell execution policy blocks `npm.ps1`).
- SQLite via Node's built-in `node:sqlite` module to avoid native builds.
- x86-64 solver binaries run under Windows 11 ARM Prism emulation.

## Solver candidates evaluated

| Solver | Language | Fits here? |
| --- | --- | --- |
| TexasSolver (`bupticybee/TexasSolver`) | C++ | Prebuilt x64 Windows `.exe`, no build tools. Text config -> `output_result.json`. AGPL. |
| TexasHoldemSolverJava | Java | Architecture-neutral (JVM) -> native on ARM64. MIT. Same output format. Slow on flop, fast on turn/river. Fallback. |
| postflop-solver / desktop-postflop / wasm-postflop (`b-inary`) | Rust/WASM | Needs Rust toolchain; project suspended and API unstable. Rejected. |
| TexasSolverGPU | C++/CUDA | Requires NVIDIA GPU. Rejected. |

All of these solve **heads-up postflop only**. Multiway/6-max is unsupported;
"positions" means the two players in each stored spot (OOP vs IP).

## Target repo layout

```
GTO_Trainer/
├─ app/
│  ├─ page.tsx                 # setup: matchup/street filter, session size
│  ├─ train/page.tsx           # training session (client)
│  ├─ review/page.tsx          # missed-spots summary
│  └─ api/
│     ├─ session/route.ts      # build session queue
│     └─ answer/route.ts       # grade an answer
├─ components/
│  ├─ Card.tsx  HandDisplay.tsx  Board.tsx
│  ├─ ActionBar.tsx  FrequencyBar.tsx
│  ├─ ResultPanel.tsx  Progress.tsx
├─ lib/
│  ├─ db.ts  types.ts  cards.ts  grading.ts
├─ scripts/
│  ├─ spots.config.mjs  generate-inputs.mjs
│  ├─ run-solver.mjs    parse-and-load.mjs
├─ solver/                     # gitignored: downloaded solver + resources
├─ data/
│  ├─ inputs/    raw/          # generated configs + solver JSON
│  └─ gto.db                   # built database
└─ solver/README.md            # exact invocation + license note
```

## Step 1 — Solver spike (prove it runs locally)

1. Download `TexasSolver-v0.2.0-Windows.zip`, unzip to `solver/texassolver/`
   (add to `.gitignore`).
2. Run the bundled sample:
   `solver\texassolver\console_solver.exe -i solver\texassolver\resources\text\commandline_sample_input.txt`
   Confirm it completes under ARM emulation and writes `output_result.json`.
3. Open that JSON and document the real node schema (`node_type`, `player`,
   `actions`, `strategies`/`strategy`, `childrens`, `pot`, `effective_stack`,
   `board`). The parser is written against the real output, not guesses.
4. **Fallback if it fails or is too slow:** install Temurin JRE (ARM64) and use
   `TexasHoldemSolverJava` (`java -jar RiverSolver.jar` with a config); validate
   its output JSON the same way. Same schema, MIT license.
5. Write `solver/README.md` with the exact command, version, and AGPL note
   (offline use only; not redistributed or served over the network).

**Exit criteria:** one accurate strategy JSON produced locally with its schema
documented.

## Step 2 — Precompute pipeline (`scripts/`)

1. **`spots.config.mjs`** — array of spot definitions:
   ```js
   {
     id: "sb_bb_A72r_river",
     matchup: "SB vs BB", street: "river",
     board: "As,7h,2c,9d,3s", pot: 6.5, effectiveStack: 92,
     oopRange: "...", ipRange: "...",
     betSizes: { oop: {...}, ip: {...} },
     accuracy: 0.3, maxIter: 200,
   }
   ```
   Use SB vs BB and BTN vs BB single-raised-pot ranges at 100bb. Keep trees
   small (one bet size + all-in per street) so solves stay fast.
2. **`generate-inputs.mjs`** -> writes `data/inputs/<id>.txt` in TexasSolver
   format (`set_pot`, `set_board`, `set_range_oop/ip`, `set_bet_sizes`,
   `build_tree`, `set_accuracy`, `start_solve`, `set_dump_rounds`,
   `dump_result`).
3. **`run-solver.mjs`** -> runs solver per input, moves `output_result.json` to
   `data/raw/<id>.json`, logs final exploitability.
4. **`parse-and-load.mjs`** -> traverses the JSON tree, extracts decision nodes
   and per-hand frequencies, normalizes into SQLite.
5. npm scripts: `data:gen`, `data:solve`, `data:parse`, `data:build` (all three).

**Exit criteria:** `data/gto.db` populated; a sanity query returns per-hand
frequencies that sum to ~1.

## Step 3 — Database schema (`node:sqlite`)

```sql
spots(id PK, name, matchup, street, board, pot, effective_stack,
      oop_pos, ip_pos, oop_range, ip_range, solver, exploitability, config_json)
nodes(id PK, spot_id FK, history, street, actor_pos, pot, stack, action_json)
strategies(node_id FK, hand, action_index, freq REAL, ev REAL)
-- index: (spot_id), (node_id, hand)
```

## Step 4 — Next.js app

- `npx create-next-app` (TypeScript, App Router, Tailwind).
- `lib/db.ts` wraps `node:sqlite` (read-only at runtime); `lib/cards.ts`
  parses/renders card codes; `lib/grading.ts` implements mixed-strategy scoring.
- API `POST /api/session`: filters by matchup/street, samples nodes x hero hands,
  returns an ordered queue (OOP items then IP items — the "cycle through
  positions").
- API `POST /api/answer`: given `{ nodeId, hand, chosenActionIndex }`, returns
  the full frequency vector, EV per action, the max-frequency action, and the
  score (chosen action's frequency).
- Pages/components as in the layout above.

## Step 5 — Training loop UX

1. Setup page: choose matchup, street, number of questions -> start.
2. Question view: board, pot, stack, **position label** (OOP/IP), hero's two hole
   cards, action buttons matching the node's available actions (Check / Bet X /
   Call / Raise X / All-in / Fold).
3. Answer: reveal frequency bars per action, EV, highlight the highest-frequency
   action; display the mixed-strategy score; update cumulative score/streak.
4. Next question; at the end show a review of hands where the chosen action had
   low frequency.

## Step 6 — Verification & polish

- End-to-end from a clean state: `npm install` -> `npm run data:build` ->
  `npm run dev` -> complete a session.
- Keyboard shortcuts, responsive card rendering, empty/error states.
- README: setup, data pipeline commands, license caveats.

## Risks & mitigations

- **ARM emulation fails or is slow** -> Java fallback (Step 1.4).
- **Output schema differs by version** -> parser built from the real spike output.
- **Flop cost** -> avoided in MVP (river + turn only).
- **`node:sqlite` experimental warning** -> cosmetic; fall back to
  `better-sqlite3` only if needed.
