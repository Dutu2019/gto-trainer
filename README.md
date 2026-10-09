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

- Node.js 22+ (developed on 23.11). No other toolchain needed — the solver ships
  as a prebuilt Windows x64 binary and runs under Windows 11 ARM emulation.
- PowerShell users: call `npm.cmd` if `npm.ps1` is blocked by execution policy.

## Setup

```powershell
npm install
npm run data:build   # generate inputs -> solve -> load SQLite
npm run dev
```

Open http://localhost:3000.

### Data pipeline commands

| Command             | Does                                                        |
| ------------------- | ----------------------------------------------------------- |
| `npm run data:gen`  | Writes solver inputs to `data/inputs/*.txt`                 |
| `npm run data:solve`| Runs the solver, writes `data/raw/*.json` + logs            |
| `npm run data:load` | Parses raw output and rebuilds `data/gto.db`                |
| `npm run data:build`| All three, in order                                         |

Spot definitions and ranges live in `scripts/spots.config.mjs`. Add a spot there
and re-run `npm run data:build` to include it.

## Training

1. Pick matchups, streets, and a question count.
2. For each spot you see the board, your hole cards, your position, pot and
   effective stack, and the legal actions.
3. After you pick, the GTO frequency for every action is shown. Your score is
   the frequency of the action you chose, so mixed spots award partial credit.
4. A session alternates OOP and IP questions; the summary reviews every hand.

## Solver notes

- The Windows binary is unpacked to `solver/texassolver/` (gitignored).
- Player mapping in solver output: **player 1 = OOP, player 0 = IP**.
- The pipeline dumps only the starting street (`set_dump_rounds 1`) to keep the
  MVP database small; turn spots are still solved through the river internally.
- License: TexasSolver is **AGPL v3** and is used locally for personal study
  only. See `solver/README.md`.

### Fallback (ARM64)

If the x64 binary fails to run under emulation, install an ARM64 JRE and use
[TexasHoldemSolverJava](https://github.com/bupticybee/TexasHoldemSolverJava)
(MIT), which produces the same output JSON format.

## Layout

```
app/            Next.js routes (page + /api/session + /api/answer)
components/     React trainer UI
lib/            db access, types, cards, grading
scripts/        spot config + build pipeline
solver/         downloaded solver binary (gitignored)
data/           generated inputs/raw JSON/gto.db (gitignored)
```
