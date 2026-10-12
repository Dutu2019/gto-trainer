# Solver (offline strategy generation)

This folder holds a local copy of an open-source GTO solver that is used **offline**
to precompute postflop strategies. Those strategies are parsed into `data/gto.db`
and served read-only by the Next.js app. The solver is **not** redistributed and is
**not** exposed over the network.

## Chosen solver

- **TexasSolver v0.2.0 (C++ console)** — https://github.com/bupticybee/TexasSolver
- Release assets are **x86-64** builds:
  `TexasSolver-v0.2.0-Windows.zip`, `...-Linux.zip`, `...-MacOs.zip`.
- Binary (this platform): `solver/texassolver/console_solver.exe` (or
  `console_solver` on Linux/macOS).
- License: **GNU AGPL v3**. Used locally for personal strategy study only.

Install it with:

```powershell
npm run solver:setup            # picks the asset for process.platform
npm run solver:setup -- --force # re-download
```

The download is driven by `scripts/solver.mjs`, which also resolves the binary
path for `run-solver.mjs` and reports a clear error when it is missing.

On **x64** hosts the binary runs natively. On **ARM64** hosts there is no native
build: the x64 binary runs under emulation (Windows 11 ARM Prism, etc.). If that
is too slow, fall back to **TexasHoldemSolverJava** (MIT, requires an ARM64 JRE),
which produces the same output JSON format.

## Running the bundled sample

```powershell
solver\texassolver\console_solver.exe -i solver\texassolver\resources\text\commandline_sample_input.txt
```

This writes `output_result.json` in the current working directory.

## Input format

The solver is driven by a plain-text config. Key directives:

```
set_pot <chips>
set_effective_stack <chips>
set_board <Card,Card,Card[,Card[,Card]]>   # flop / turn / river
set_range_oop <range>
set_range_ip  <range>
set_bet_sizes oop,<street>,bet,<pct[,pct...]>
set_bet_sizes oop,<street>,raise,<pct[,pct...]>
set_bet_sizes oop,<street>,allin
set_bet_sizes ip,<street>,...
set_allin_threshold <fraction>
build_tree
set_thread_num <n>
set_accuracy <pct>
set_max_iteration <n>
set_print_interval <n>
set_use_isomorphism 0|1
start_solve
set_dump_rounds <n>
dump_result output_result.json
```

Ranges are comma-separated combos (`AA`, `AKs`, `AKo`, `AK`) with optional weights
(`AQs:0.75`).

## Output

`output_result.json` contains the solved tree: decision nodes with the acting
player, the available actions, and a per-hand frequency distribution over those
actions. The exact schema is documented in `../data/README.md` (captured from the
sample run) and consumed by `scripts/parse-and-load.mjs`.
