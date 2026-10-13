// Download and unpack the TexasSolver console binary for THIS machine's
// platform (x64 Windows/Linux/macOS). Idempotent: pass --force to re-download.
//
//   node scripts/setup-solver.mjs [--force]
//
// The release ships x86-64 builds. On x64 hosts they run natively; on ARM64
// hosts (e.g. Windows 11 ARM) they run under emulation, or you can use the
// TexasHoldemSolverJava fallback described in solver/README.md.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ROOT,
  SOLVER_DIR,
  EXE_NAME,
  EXE_PATH,
  solverAsset,
  solverExists,
  isEmulated,
  hostLabel,
} from "./solver.mjs";

const force = process.argv.includes("--force");

function log(msg) {
  console.log(`[solver:setup] ${msg}`);
}

function fail(msg) {
  console.error(`[solver:setup] ${msg}`);
  process.exit(1);
}

async function download(url, dest) {
  log(`downloading ${url}`);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) fail(`download failed: HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  log(`saved ${(buf.length / 1024 / 1024).toFixed(1)} MB -> ${path.relative(ROOT, dest)}`);
}

function extract(zip, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === "win32") {
    const res = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`,
      ],
      { stdio: "inherit" },
    );
    if (res.status !== 0) fail("Expand-Archive failed");
  } else {
    const res = spawnSync("unzip", ["-o", zip, "-d", dest], { stdio: "inherit" });
    if (res.status !== 0) fail("unzip failed (install `unzip` and retry)");
  }
}

/** Recursively find the directory that directly contains the solver binary. */
function findSolverDir(dir) {
  if (fs.existsSync(path.join(dir, EXE_NAME))) return dir;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = findSolverDir(path.join(dir, entry.name));
    if (found) return found;
  }
  return null;
}

const asset = solverAsset();
if (!asset) {
  fail(
    `no TexasSolver build for ${process.platform}. ` +
      `Supported: win32, linux, darwin.`,
  );
}

if (solverExists() && !force) {
  log(`already installed: ${path.relative(ROOT, EXE_PATH)} (use --force to refresh)`);
  process.exit(0);
}

log(`host: ${hostLabel()}`);
log(`target: ${path.relative(ROOT, SOLVER_DIR)}`);

const zipPath = path.join(ROOT, "solver", asset.file);
const extractDir = path.join(ROOT, "solver", ".extract");

try {
  await download(asset.url, zipPath);
  extract(zipPath, extractDir);

  const found = findSolverDir(extractDir);
  if (!found) fail(`could not find ${EXE_NAME} inside ${asset.file}`);

  fs.rmSync(SOLVER_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(SOLVER_DIR), { recursive: true });
  fs.cpSync(found, SOLVER_DIR, { recursive: true });
  if (process.platform !== "win32") {
    fs.chmodSync(EXE_PATH, 0o755);
  }

  if (!solverExists()) fail(`install finished but ${EXE_PATH} is missing`);
  log(`installed ${path.relative(ROOT, EXE_PATH)}`);
  if (isEmulated()) {
    log(
      `note: ${process.arch} has no native build; the x64 binary will run under emulation.`,
    );
  }
} finally {
  fs.rmSync(extractDir, { recursive: true, force: true });
}
