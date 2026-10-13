// Shared platform/architecture resolution for the offline TexasSolver binary.
//
// The pinned v0.2.0 release only ships x86-64 builds (Windows/Linux/macOS).
// On an x64 host they run natively; on ARM64 they must run under emulation
// (e.g. Windows 11 Prism) or be replaced with the Java solver fallback.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SOLVER_VERSION = "v0.2.0";
const RELEASE_BASE = `https://github.com/bupticybee/TexasSolver/releases/download/${SOLVER_VERSION}`;

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const SOLVER_DIR = path.join(ROOT, "solver", "texassolver");

export const EXE_NAME =
  process.platform === "win32" ? "console_solver.exe" : "console_solver";
export const EXE_PATH = path.join(SOLVER_DIR, EXE_NAME);

export const ASSETS = {
  win32: {
    file: "TexasSolver-v0.2.0-Windows.zip",
    url: `${RELEASE_BASE}/TexasSolver-v0.2.0-Windows.zip`,
  },
  linux: {
    file: "TexasSolver-v0.2.0-Linux.zip",
    url: `${RELEASE_BASE}/TexasSolver-v0.2.0-Linux.zip`,
  },
  darwin: {
    file: "TexasSolver-v0.2.0-MacOs.zip",
    url: `${RELEASE_BASE}/TexasSolver-v0.2.0-MacOs.zip`,
  },
};

/** Release asset for a platform, or null if there is no build for it. */
export function solverAsset(platform = process.platform) {
  return ASSETS[platform] ?? null;
}

/** True when the host CPU is not x86-64 and needs emulation for the x64 build. */
export function isEmulated(arch = process.arch) {
  return !["x64", "ia32"].includes(arch);
}

/** Human-readable host description for logs and error messages. */
export function hostLabel(
  platform = process.platform,
  arch = process.arch,
) {
  return `${platform}-${arch}${isEmulated(arch) ? " (x64 build under emulation)" : " (native x64)"}`;
}

export function solverExists() {
  return fs.existsSync(EXE_PATH);
}

/** Path to the solver binary, throwing an actionable error when missing. */
export function requireSolver() {
  if (solverExists()) return EXE_PATH;
  throw new Error(
    `TexasSolver binary not found at ${EXE_PATH}.\n` +
      `Host: ${hostLabel()}.\n` +
      `Download it with "npm run solver:setup" (or "node scripts/setup-solver.mjs").\n` +
      (isEmulated()
        ? `No native build exists for ${process.arch}; on ARM64 the x64 binary runs ` +
          `under emulation, or install an ARM64 JRE and use TexasHoldemSolverJava.`
        : `Host is native x64, so the downloaded x64 build will run directly.`),
  );
}
