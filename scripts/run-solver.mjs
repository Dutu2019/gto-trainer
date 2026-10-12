// Run the TexasSolver console binary for every generated input and collect the
// resulting strategy JSON into data/raw/<id>.json (plus a .log).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { spots } from "./spots.config.mjs";
import { ROOT, SOLVER_DIR, requireSolver, hostLabel } from "./solver.mjs";

const INPUT_DIR = path.join(ROOT, "data", "inputs");
const RAW_DIR = path.join(ROOT, "data", "raw");

let EXE;
try {
  EXE = requireSolver();
} catch (err) {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
}
console.log(`solver: ${path.relative(ROOT, EXE)} on ${hostLabel()}`);

function exploitabilityFromLog(log) {
  const m = [...log.matchAll(/Total exploitability\s+([\d.]+)/g)];
  return m.length ? Number(m[m.length - 1][1]) : null;
}

function runSpot(spot) {
  const inputFile = path.join(INPUT_DIR, `${spot.id}.txt`);
  if (!fs.existsSync(inputFile)) {
    console.error(`missing input ${inputFile}; run "npm run data:gen" first`);
    return false;
  }
  console.log(`\n=== solving ${spot.id} (${spot.street}, ${spot.matchup}) ===`);
  const t0 = Date.now();
  const res = spawnSync(EXE, ["-i", inputFile], {
    cwd: SOLVER_DIR,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const log = `${res.stdout || ""}\n${res.stderr || ""}`;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (res.status !== 0) {
    console.error(`solver failed (status ${res.status}) after ${secs}s`);
    console.error(log.slice(-2000));
    return false;
  }
  const produced = path.join(SOLVER_DIR, "output_result.json");
  if (!fs.existsSync(produced)) {
    console.error("solver produced no output_result.json");
    return false;
  }
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const target = path.join(RAW_DIR, `${spot.id}.json`);
  fs.writeFileSync(target, fs.readFileSync(produced));
  fs.unlinkSync(produced);
  fs.writeFileSync(path.join(RAW_DIR, `${spot.id}.log`), log, "utf8");
  const expl = exploitabilityFromLog(log);
  console.log(
    `done in ${secs}s -> ${path.relative(ROOT, target)}` +
      (expl != null ? ` (final exploitability ${expl}%)` : ""),
  );
  return true;
}

let ok = 0;
for (const spot of spots) {
  if (runSpot(spot)) ok++;
}
console.log(`\n${ok}/${spots.length} spots solved.`);
if (ok !== spots.length) process.exit(1);
