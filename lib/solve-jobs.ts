// Runs the offline solver for one user-requested spot and tracks its progress.
//
// Flow: write a TexasSolver input into data/inputs/<stem>.txt, spawn
// scripts/run-and-import.js for just that file (it solves and imports the tree
// into data/gto.db), and expose the job state so the UI can poll it and tell
// the user when the solve is ready.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { buildSolverInput, spotStem, streetFor, type SpotConfig } from "./solver-input";
import { buildContinuation } from "./continuation";
import { readPreflopLine } from "./preflop";

const ROOT = process.cwd();
const INPUTS_DIR = path.join(ROOT, "data", "inputs");
const DB_PATH = process.env.GTO_DB_PATH ?? path.join(ROOT, "data", "gto.db");
const RUNNER = path.join(ROOT, "scripts", "run-and-import.js");
/**
 * Hard deadline for one solve. run-and-import.js kills the solver at this
 * point, so a solve that runs out of memory (and therefore stops printing
 * iterations without ever exiting) fails instead of leaving the job "running"
 * forever.
 */
const SOLVE_TIMEOUT_SEC = Number(process.env.GTO_SOLVE_TIMEOUT_SEC ?? 1800);

export type JobStatus = "running" | "done" | "error";

export type SolveJob = {
  id: string;
  stem: string;
  sourceFile: string;
  label: string;
  board: string;
  street: string;
  status: JobStatus;
  log: string;
  spotId: number | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
};

// Survive dev hot-reloads the same way lib/db.ts does.
const g = globalThis as unknown as { __solveJobs?: Map<string, SolveJob> };
const jobs: Map<string, SolveJob> = (g.__solveJobs ??= new Map());

export function getJob(id: string): SolveJob | null {
  return jobs.get(id) ?? null;
}

export function listJobs(): SolveJob[] {
  return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/** Normalise "qs" -> "Qs"; returns null when the card is invalid. */
function normCard(card: string): string | null {
  const m = /^([2-9TJQKA])([shdc])$/i.exec(card.trim());
  return m ? m[1].toUpperCase() + m[2].toLowerCase() : null;
}

export type StartSolveInput = {
  lineId: string;
  /** 3–5 cards, either "Qs Jh 4d" or ["Qs","Jh","4d"]. */
  board: string | string[];
  force?: boolean;
};

export type StartSolveResult =
  | { ok: true; job: SolveJob; cached: boolean }
  | { ok: false; error: string; status: number };

/** Everything one solve job needs, whether it starts from preflop or a node. */
type LaunchSpec = {
  stem: string;
  sourceFile: string;
  label: string;
  board: string;
  street: string;
  /** Solver input text written to data/inputs/<stem>.txt. */
  input: string;
  /**
   * Pot/stack this line implies: a cached spot with the same board but a
   * different setup must be re-solved, not reused.
   */
  expect?: { potBb: number; effStackBb: number };
  /**
   * Board-only source name used before stems carried an identity hash. Looked
   * up as a fallback so already-solved trees are reused instead of re-solved
   * (and duplicated) after the naming change.
   */
  legacySourceFile?: string;
  /** Set for continuations so the viewer can keep the parent's trail on screen. */
  ancestry?: { parentSpotId: number; parentPath: string; dealtCard: string };
};

function matches(actual: number | null, expected: number): boolean {
  return actual != null && Math.abs(actual - expected) < 0.01;
}

export function startSolve(input: StartSolveInput): StartSolveResult {
  const line = readPreflopLine(input.lineId);
  if (!line) return { ok: false, error: `unknown preflop line '${input.lineId}'`, status: 404 };
  if (!line.flopReachable)
    return {
      ok: false,
      error: line.headsUp
        ? "that line is an all-in preflop — there is no flop to solve"
        : "that line is not heads-up; the solver is two-player only",
      status: 400,
    };
  if (!line.oop || !line.ip)
    return { ok: false, error: "line is missing its OOP/IP seats", status: 400 };

  const rawCards = Array.isArray(input.board)
    ? input.board
    : String(input.board).match(/[2-9TJQKA][shdc]/gi) ?? [];
  const cards = rawCards.map(normCard);
  if (cards.length < 3 || cards.length > 5)
    return { ok: false, error: "pick 3, 4 or 5 cards (flop, then turn, then river)", status: 400 };
  if (cards.some((c) => c === null)) return { ok: false, error: "invalid card", status: 400 };
  if (new Set(cards).size !== cards.length)
    return { ok: false, error: "duplicate card", status: 400 };

  const boardStr = cards.join("");
  const street = streetFor(cards.length);
  // The stem carries a hash of the preflop line, so two lines that reach the
  // same seats and flop get separate rows (board alone would collide).
  const stem = spotStem(line.oop, line.ip, street, boardStr, `line:${line.id}:${line.potBb}:${line.effStackBb}`);

  const cfg: SpotConfig = {
    oop: line.oop,
    ip: line.ip,
    board: cards as string[],
    potBb: line.potBb,
    effStackBb: line.effStackBb,
    rangeOop: line.ranges[line.oop].raw,
    rangeIp: line.ranges[line.ip].raw,
  };

  return launch(
    {
      stem,
      sourceFile: `${stem}.json`,
      label: `${line.label} · ${street}`,
      board: boardStr,
      street,
      input: buildSolverInput(cfg),
      expect: { potBb: line.potBb, effStackBb: line.effStackBb },
      legacySourceFile: `${line.oop.toLowerCase()}_${line.ip.toLowerCase()}_${street}_${boardStr}.json`,
    },
    input.force,
  );
}

export type StartContinuationInput = {
  /** Spot the action path belongs to. */
  fromSpotId: number;
  /** Action path of the chance node where the street ends (e.g. "x-b2-c"). */
  path: string;
  /** Card that starts the next street, e.g. "9d". */
  card: string;
  force?: boolean;
};

/**
 * Solve the next street of an already solved tree, carrying over the ranges
 * that actually reach the end-of-street node.
 */
export function startContinuation(input: StartContinuationInput): StartSolveResult {
  const built = buildContinuation(input.fromSpotId, input.path, input.card);
  if (!built.ok) return { ok: false, error: built.error, status: built.status };
  const { cfg, stem, board, street, label, card } = built.built;
  return launch(
    {
      stem,
      sourceFile: `${stem}.json`,
      label,
      board,
      street,
      input: buildSolverInput(cfg),
      expect: { potBb: cfg.potBb, effStackBb: cfg.effStackBb },
      legacySourceFile: `${cfg.oop.toLowerCase()}_${cfg.ip.toLowerCase()}_${street}_${board}.json`,
      // Store the chance node the card was dealt at; the viewer resolves it to
      // the decision that closed the street and marks that action as taken.
      ancestry: { parentSpotId: input.fromSpotId, parentPath: input.path, dealtCard: card },
    },
    input.force,
  );
}

/** Shared tail end: cache lookup, input file, job record, solver child process. */
function launch(spec: LaunchSpec, force?: boolean): StartSolveResult {
  // One solve at a time: a deep flop tree peaks around 6 GB, so two in
  // parallel is how a machine with 32 GB ends up thrashing.
  const running = [...jobs.values()].find((j) => j.status === "running");
  if (running) {
    return {
      ok: false,
      error: `a solve is already running (${running.label}) — wait for it to finish`,
      status: 409,
    };
  }

  const { stem, sourceFile, label, board, street, input, expect, legacySourceFile } = spec;
  // Unique identity first; fall back to the old board-only name so trees solved
  // before the change are reused instead of duplicated.
  const cached = findSpot(sourceFile) ?? (legacySourceFile ? findSpot(legacySourceFile) : null);
  // A cached spot is only reusable when the pot and stack match what this line
  // implies (a different line can reach the same board).
  const sameSetup =
    cached != null &&
    (expect == null || (matches(cached.potBb, expect.potBb) && matches(cached.effStackBb, expect.effStackBb)));
  if (sameSetup && !force) {
    // A reused tree still needs its lineage if it predates the ancestry columns.
    if (spec.ancestry) recordAncestry(cached.spotId, spec.ancestry);
    const job: SolveJob = {
      id: crypto.randomUUID(),
      stem,
      sourceFile,
      label,
      board,
      street,
      status: "done",
      log: "Already solved — reusing the stored tree.",
      spotId: cached.spotId,
      error: null,
      startedAt: Date.now(),
      finishedAt: Date.now(),
    };
    jobs.set(job.id, job);
    return { ok: true, job, cached: true };
  }

  fs.mkdirSync(INPUTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(INPUTS_DIR, `${stem}.txt`), input);

  const job: SolveJob = {
    id: crypto.randomUUID(),
    stem,
    sourceFile,
    label,
    board,
    street,
    status: "running",
    log: "",
    spotId: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(job.id, job);

  const child = spawn(
    process.execPath,
    // --force: always solve from the input we just wrote. Without it the
    // runner reuses an older data/raw/<stem>.json (or skips as "stale") and a
    // changed bet-size config would never be re-solved.
    [RUNNER, "--only", stem, "--force", "--timeout", String(SOLVE_TIMEOUT_SEC)],
    {
      cwd: ROOT,
      windowsHide: true,
    },
  );
  child.stdout?.on("data", (b) => append(job, b.toString()));
  child.stderr?.on("data", (b) => append(job, b.toString()));
  child.on("error", (err) => {
    job.status = "error";
    job.error = String(err.message ?? err);
    job.finishedAt = Date.now();
  });
  child.on("close", (code) => {
    job.finishedAt = Date.now();
    if (code !== 0) {
      job.status = "error";
      // Surface the runner's own diagnosis (it prints "solve: FAILED — ..."),
      // which is far more useful than the bare exit code.
      const failed = job.log
        .split(/\r?\n/)
        .filter((l) => /FAILED/.test(l))
        .pop();
      job.error = failed?.trim() ?? `run-and-import exited with code ${code}`;
      return;
    }
    const spotId = findSpot(sourceFile)?.spotId ?? null;
    if (spotId === null) {
      job.status = "error";
      job.error = "the solver finished but no spot was imported";
      return;
    }
    if (spec.ancestry) recordAncestry(spotId, spec.ancestry);
    job.status = "done";
    job.spotId = spotId;
  });

  return { ok: true, job, cached: false };
}

function append(job: SolveJob, text: string) {
  // keep the tail only — solver logs are long
  job.log = (job.log + text).slice(-8000);
}

/** Link a freshly imported spot to the node it was continued from. */
function recordAncestry(
  spotId: number,
  a: { parentSpotId: number; parentPath: string; dealtCard: string },
) {
  if (!fs.existsSync(DB_PATH)) return;
  const db = new Database(DB_PATH, { fileMustExist: true });
  try {
    db.prepare(
      `UPDATE spots SET parent_spot_id = ?, parent_path = ?, dealt_card = ?
        WHERE spot_id = ? AND parent_spot_id IS NULL`,
    ).run(a.parentSpotId, a.parentPath, a.dealtCard, spotId);
  } finally {
    db.close();
  }
}

/** Look up a spot by its source filename. */
function findSpot(sourceFile: string): {
  spotId: number;
  potBb: number | null;
  effStackBb: number | null;
} | null {
  if (!fs.existsSync(DB_PATH)) return null;
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const row = db
      .prepare("SELECT spot_id, pot_bb, eff_stack_bb FROM spots WHERE source_file = ?")
      .get(sourceFile) as
      | { spot_id: number; pot_bb: number | null; eff_stack_bb: number | null }
      | undefined;
    return row
      ? { spotId: row.spot_id, potBb: row.pot_bb, effStackBb: row.eff_stack_bb }
      : null;
  } finally {
    db.close();
  }
}
