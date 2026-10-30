#!/usr/bin/env node
// Batch runner: solve every input in data/inputs with the local TexasSolver
// binary and import each resulting tree into the SQLite database.
//
// Usage (run from the repo root):
//   node scripts/run-and-import.js                 # solve + import every input
//   node scripts/run-and-import.js --only btn_bb   # inputs whose stem contains "btn_bb"
//   node scripts/run-and-import.js --import-only   # reuse data/raw/*.json, skip solving
//   node scripts/run-and-import.js --force         # re-solve + re-import over existing results
//   node scripts/run-and-import.js --timeout 600   # kill a solve after 600 seconds
//   node scripts/run-and-import.js --timeout 0     # no deadline (default: 1800s)
//
// How it works:
// - The solver is executed with CWD = its own directory (solver/texassolver):
//   it resolves its DLLs and reads/writes files relative to that directory, so
//   the input file is passed as a path relative to it.
// - The solver always writes ./output_result.json next to the exe. Before each
//   run any stale copy is removed, and afterwards the fresh file is moved to
//   data/raw/<input-stem>.json. The solver's stdout/stderr are streamed to
//   data/raw/<input-stem>.log as they arrive (the solver prints its
//   progress/exploitability tables there, not to a log file), so a running
//   solve leaves a growing log behind instead of an empty one.
// - Every solve is bounded by --timeout (default 1800s). A solver that runs out
//   of memory stops printing iterations and never exits, so without a deadline
//   one bad input would leave the job "running" forever.
// - Spot metadata comes from the input filename "<oop>_<ip>_<street>_<board>"
//   (e.g. btn_bb_river_QsJh4d8c3s → OOP=BTN, IP=BB) plus the set_* lines inside
//   the file (board, pot, effective stack); board and street are cross-checked.
// - Trees are imported via importSolve() from scripts/import-solve.js into
//   data/gto.db. spots has UNIQUE(source_file), so a re-import deletes the old
//   spot row first (all child tables cascade).
// - createDb() resolves the database and schema.sql from the process CWD, so
//   this script chdirs to the repo root before touching the DB.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { ROOT, SOLVER_DIR, requireSolver } from "./solver.js";
import { createDb } from "./create-db.js";
import { importSolve } from "./import-solve.js";

const INPUTS_DIR = path.join(ROOT, "data", "inputs");
const RAW_DIR = path.join(ROOT, "data", "raw");
const SOLVER_RESULT = path.join(SOLVER_DIR, "output_result.json");

// ---------------------------------------------------------------- CLI parsing

const DEFAULT_TIMEOUT_SEC = 1800;

function parseCli(argv) {
  const out = {
    only: null,
    importOnly: false,
    force: false,
    timeoutSec: DEFAULT_TIMEOUT_SEC,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--only") out.only = argv[++i] ?? die("--only needs a value");
    else if (a === "--import-only") out.importOnly = true;
    else if (a === "--force") out.force = true;
    else if (a === "--timeout") {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v < 0)
        die("--timeout needs seconds (0 disables the deadline), e.g. --timeout 600");
      out.timeoutSec = v;
    } else if (a === "--help" || a === "-h") out.help = true;
    else die(`unknown argument: ${a} (see --help)`);
  }
  return out;
}

function die(msg) {
  console.error(`run-and-import: ${msg}`);
  process.exit(1);
}

function printHelp() {
  console.log(`Batch-solve every input in data/inputs and import the trees into data/gto.db.

Usage:
  node scripts/run-and-import.js [options]

Options:
  --only <text>    only process inputs whose filename contains <text>
  --import-only    skip solving; import the existing data/raw/*.json results
  --force          re-solve inputs that already have a result, and re-import
                   spots that are already in the database
  --timeout <sec>  kill a solve after <sec> seconds (default: ${DEFAULT_TIMEOUT_SEC};
                   use 0 to disable the deadline)
  -h, --help       show this help

The solver (console_solver.exe) runs with CWD = solver/texassolver and is
called as "console_solver.exe --input_file <relative path to the input>";
it writes output_result.json next to itself, which this script moves to
data/raw/<input-stem>.json and imports.`);
}

// ------------------------------------------------------------- input metadata

/** Parse the solver input file into a key -> rest-of-line map (set_* lines). */
function parseInput(inputPath) {
  const kv = new Map();
  for (const raw of fs.readFileSync(inputPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const toks = line.split(/\s+/);
    if (toks[0].startsWith("set_")) kv.set(toks[0], toks.slice(1).join(" "));
  }
  return kv;
}

/**
 * Spot metadata for importSolve(). Positions are not in the input file — they
 * come from the filename convention "<oop>_<ip>_<street>_<board>[_<id>]"
 * (e.g. btn_bb_river_QsJh4d8c3s_1a2b3c4d: OOP=BTN, IP=BB). The trailing id is
 * the spot identity hash (see spotStem in lib/solver-input.ts) and is ignored
 * here; it only keeps distinct solves on distinct files. The board is
 * cross-checked against set_board and the street against the board size.
 */
function readMeta(inputPath) {
  const stem = path.basename(inputPath, ".txt");
  const [oop, ip, street, fileBoard, ...rest] = stem.split("_");
  if (!oop || !ip || !street || !fileBoard || rest.length > 1) {
    throw new Error(
      `cannot parse filename '${stem}': expected <oop>_<ip>_<street>_<board>[_<id>]`,
    );
  }
  const kv = parseInput(inputPath);
  const board = (kv.get("set_board") ?? "")
    .split("#")[0]
    .replace(/,/g, "")
    .trim();
  if (!board) throw new Error("input file has no set_board line");
  if (board !== fileBoard) {
    throw new Error(
      `board mismatch: filename '${fileBoard}' vs set_board '${board}'`,
    );
  }
  const nBoard = board.length / 2;
  const inferred = { 3: "flop", 4: "turn", 5: "river" }[nBoard];
  if (inferred !== street) {
    throw new Error(
      `street '${street}' contradicts the ${nBoard}-card board '${board}' (${inferred})`,
    );
  }
  const num = (key) => {
    const v = parseFloat(kv.get(key));
    return Number.isFinite(v) ? v : null;
  };
  return {
    oop: oop.toUpperCase(),
    ip: ip.toUpperCase(),
    street,
    board,
    pot: num("set_pot"),
    stack: num("set_effective_stack"),
  };
}

// ----------------------------------------------------------------- solver run

/**
 * Run the solver on one input, streaming its output to data/raw/<stem>.log.
 *
 * Streams instead of buffering (the old spawnSync approach held the whole log
 * in memory, wrote it only after the solve ended, and would kill the solver
 * once its output passed spawnSync's 1 MB maxBuffer), and reports progress as
 * the solver prints iteration tables.
 */
function runSolver(exe, inputPath, stem, opts) {
  const logPath = path.join(RAW_DIR, `${stem}.log`);
  const jsonPath = path.join(RAW_DIR, `${stem}.json`);

  // The solver resolves paths relative to its own directory, and Windows
  // wants backslashes-free relative args.
  const relInput = path.relative(SOLVER_DIR, inputPath).split(path.sep).join("/");
  // The bundled v0.2.0 console build parses exactly: --input_file <path>
  // (optional: --resource_dir, --mode); unknown flags make it exit(1).
  const args = ["--input_file", relInput];

  // Never leave a stale result next to the exe.
  if (fs.existsSync(SOLVER_RESULT)) fs.rmSync(SOLVER_RESULT);

  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const log = fs.createWriteStream(logPath, { flags: "w" });
    const child = spawn(exe, args, {
      cwd: SOLVER_DIR,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let timedOut = false;
    let finished = false;
    const deadline =
      opts.timeoutSec > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
          }, opts.timeoutSec * 1000)
        : null;
    const heartbeat = setInterval(() => {
      console.log(`solve: still running (${Math.round((Date.now() - t0) / 1000)}s)`);
    }, 30_000);

    // The solver redraws an ASCII progress bar with backspaces; keep whole
    // lines only and forward the iteration summaries to our own stdout so the
    // web job log shows live progress.
    let tail = "";
    const onData = (chunk) => {
      log.write(chunk);
      tail += chunk.toString("utf8");
      const lines = tail.split(/\r?\n/);
      tail = lines.pop() ?? "";
      for (const line of lines) {
        const m = /^Total exploitability ([\d.]+)/.exec(line);
        if (m) console.log(`solve: exploitability ${m[1]}%`);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    const stop = () => {
      if (deadline) clearTimeout(deadline);
      clearInterval(heartbeat);
    };

    child.on("error", (err) => {
      if (finished) return;
      finished = true;
      stop();
      log.end(() => reject(new Error(`failed to start solver: ${err.message}`)));
    });

    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      stop();
      const seconds = (Date.now() - t0) / 1000;
      log.end(() => {
        if (timedOut) {
          reject(
            new Error(
              `solve timed out after ${opts.timeoutSec}s (log: ${logPath}) — ` +
                "the tree is too big for this machine; fewer bet sizes help",
            ),
          );
          return;
        }
        if (code !== 0) {
          reject(
            new Error(
              `solver exited with ${code ?? signal} after ${seconds.toFixed(0)}s ` +
                `(log: ${logPath}) — an exit right after "Iter: 0" usually means ` +
                "it ran out of memory",
            ),
          );
          return;
        }
        if (!fs.existsSync(SOLVER_RESULT)) {
          reject(new Error(`solver wrote no ${path.basename(SOLVER_RESULT)} (log: ${logPath})`));
          return;
        }
        try {
          fs.rmSync(jsonPath, { force: true });
          try {
            fs.renameSync(SOLVER_RESULT, jsonPath);
          } catch {
            // cross-device fallback: copy + unlink
            fs.copyFileSync(SOLVER_RESULT, jsonPath);
            fs.rmSync(SOLVER_RESULT);
          }
          resolve({ jsonPath, logPath, seconds });
        } catch (err) {
          reject(err);
        }
      });
    });
  });
}

// ----------------------------------------------------------------------- main

function listInputs(only) {
  let files = fs
    .readdirSync(INPUTS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".txt"))
    .sort();
  if (only) {
    const needle = only.toLowerCase();
    files = files.filter((f) => f.toLowerCase().includes(needle));
  }
  return files.map((f) => path.join(INPUTS_DIR, f));
}

async function main() {
  const opts = parseCli(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  // createDb() and schema.sql are resolved from the process CWD.
  process.chdir(ROOT);

  const exe = requireSolver();
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const inputs = listInputs(opts.only);
  if (inputs.length === 0) {
    console.log(`no matching .txt inputs in ${INPUTS_DIR}`);
    return;
  }
  console.log(`${inputs.length} input(s) to process\n`);

  const db = createDb();
  const spotExists = db.prepare("SELECT 1 FROM spots WHERE source_file = ?");
  const deleteSpot = db.prepare("DELETE FROM spots WHERE source_file = ?");

  let solved = 0;
  let reused = 0;
  let staleSkipped = 0;
  let imported = 0;
  let importSkipped = 0;
  let failed = 0;

  for (const inputPath of inputs) {
    const stem = path.basename(inputPath, ".txt");
    console.log(`=== ${stem} ===`);

    const jsonPath = path.join(RAW_DIR, `${stem}.json`);
    const haveJson = fs.existsSync(jsonPath);
    const stale =
      haveJson && fs.statSync(jsonPath).mtimeMs < fs.statSync(inputPath).mtimeMs;

    // ---- solve step
    if (opts.importOnly) {
      if (!haveJson) {
        console.error("solve: FAILED — no existing result and --import-only is set");
        failed++;
        continue;
      }
      console.log(`solve: skipped (--import-only, using data/raw/${stem}.json)`);
    } else if (haveJson && !opts.force) {
      if (stale) {
        console.log(
          "solve: skipped — data/raw/" +
            `${stem}.json is older than the input; use --force to re-solve`,
        );
        staleSkipped++;
        continue;
      }
      console.log(`solve: skipped (data/raw/${stem}.json already exists)`);
      reused++;
    } else {
      try {
        const { seconds } = await runSolver(exe, inputPath, stem, opts);
        solved++;
        console.log(`solve: ok in ${seconds.toFixed(1)}s → data/raw/${stem}.json`);
      } catch (err) {
        console.error(`solve: FAILED — ${err.message}`);
        failed++;
        continue;
      }
    }

    // ---- import step
    try {
      const meta = readMeta(inputPath);
      const sourceFile = `${stem}.json`;
      if (spotExists.get(sourceFile) && !opts.force) {
        console.log("import: skipped (spot already in DB; use --force to re-import)");
        importSkipped++;
      } else {
        if (spotExists.get(sourceFile)) deleteSpot.run(sourceFile);
        const r = importSolve(db, jsonPath, meta);
        imported++;
        console.log(
          `import: ok → spot #${r.sid} ` +
            `(${r.nodes} nodes: ${r.action} action, ${r.chance} chance) ` +
            `[${meta.oop} vs ${meta.ip}, board ${r.board}, ${r.street}]`,
        );
      }
    } catch (err) {
      console.error(`import: FAILED — ${err.message}`);
      failed++;
    }
  }

  db.close();

  console.log(
    `\nDone: ${solved} solved, ${reused} reused, ${staleSkipped} skipped (stale), ` +
      `${imported} imported, ${importSkipped} imports skipped, ${failed} failed`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`run-and-import: ${err?.message ?? err}`);
  process.exitCode = 1;
});
