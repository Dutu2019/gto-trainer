// Server-only access to the preflop chart index written by
// scripts/build-preflop-ranges.js (npm run data:preflop).
//
// data/preflop/index.json lists every 6-max preflop line found in the solver's
// own range library; data/preflop/<id>.json holds one line in full, including
// both players' flop-starting ranges.
import fs from "node:fs";
import path from "node:path";

export const PREFLOP_DIR = path.join(process.cwd(), "data", "preflop");

export type PreflopRange = {
  /** The chart's range string, e.g. "AA:1.0,AKs:0.648,..." — solver-ready. */
  raw: string;
  /** Every hand with a non-zero weight. */
  labels: string;
  /** Only hands played at least half the time. */
  majority: string;
};

export type PreflopAction = { seat: string; action: string; to: number | null };

export type PreflopLineSummary = {
  id: string;
  label: string;
  path: string;
  openSeat: string;
  actions: PreflopAction[];
  oop: string | null;
  ip: string | null;
  headsUp: boolean;
  flopReachable: boolean;
  potBb: number;
  effStackBb: number;
};

export type PreflopLine = PreflopLineSummary & {
  live: string[];
  ranges: Record<string, PreflopRange>;
};

export type PreflopIndex = {
  generatedAt: string;
  source: string;
  stackBb: number;
  blinds: Record<string, number>;
  counts: { total: number; headsUp: number; flopReachable: number };
  lines: PreflopLineSummary[];
};

const ID = /^[a-z0-9-]+$/;

export function readPreflopIndex(): PreflopIndex | null {
  const file = path.join(PREFLOP_DIR, "index.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as PreflopIndex;
}

export function readPreflopLine(id: string): PreflopLine | null {
  if (!ID.test(id)) return null;
  const file = path.join(PREFLOP_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as PreflopLine;
}
