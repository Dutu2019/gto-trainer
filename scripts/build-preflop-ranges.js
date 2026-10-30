#!/usr/bin/env node
// Build the 6-max preflop line index used by the "solve a spot" feature.
//
//   node scripts/build-preflop-ranges.js [--src <dir>] [--out <dir>]
//
// Source: solver/texassolver/ranges/6max_range — a pre-solved 6-max preflop
// decision tree shipped with the solver. Every leaf directory holds one
// `<POS>_range.txt` per seat that is still in the hand when preflop betting
// closes; those files ARE that seat's flop starting range. Directory names
// encode the action sequence as seat/action pairs:
//
//   6max_range/<OPENER>/<open size>/<seat>/<action>/.../<seat>/<action>/
//
// A numeric segment ("2.5bb", "11.0bb") is a raise *to* that many big blinds;
// "Call", "Fold" and "AllIn" are literal actions. Seats that fold before ever
// acting are omitted from the path, so the full 6-max order is rebuilt from the
// seat set and the blind structure below.
//
// TexasSolver is two-player only, so we keep every line but flag the ones we
// can actually solve: exactly two live seats and no all-in before the flop.
// Each line is written to data/preflop/<id>.json and summarised in
// data/preflop/index.json (ranges inline, so the app needs a single read).
//
// Range files are comma-separated `Hand:weight` lists; weights are carried
// through verbatim (the solver's own charts use the same format).

import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./solver.js";

const SRC_DEFAULT = path.join(ROOT, "solver", "texassolver", "ranges", "6max_range");
const OUT_DEFAULT = path.join(ROOT, "data", "preflop");

// ---------------------------------------------------------------- config

const PREFLOP_ORDER = ["UTG", "MP", "CO", "BTN", "SB", "BB"]; // 6-max, acting order
const POSTFLOP_ORDER = ["SB", "BB", "UTG", "MP", "CO", "BTN"]; // first to act on the flop
const BLINDS = { SB: 0.5, BB: 1 };
const STACK_BB = 100;

// ---------------------------------------------------------------- helpers

const die = (msg) => {
  console.error(`build-preflop-ranges: ${msg}`);
  process.exit(1);
};

/** "2.5bb" -> 2.5 ; "Call"/"Fold"/"AllIn" -> null */
function parseSize(seg) {
  const m = /^([0-9]+(?:\.[0-9]+)?)bb$/.exec(seg);
  return m ? Number(m[1]) : null;
}

function slugify(relPath) {
  return relPath
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Parse "AA:1.0,AKs:0.648" -> [["AA",1],["AKs",0.648]] */
function parseRange(text) {
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((tok) => {
      const [hand, w] = tok.split(":");
      if (!hand) return null;
      return [hand, w === undefined ? 1 : Number(w)];
    })
    .filter(Boolean);
}

/** "AA:1.0,AKs:0.648,..." -> "AA,AKs,..." (every hand with non-zero weight) */
function rangeToLabels(text) {
  return parseRange(text)
    .filter(([, w]) => w > 0)
    .map(([h]) => h)
    .join(",");
}

/** The same list, but only hands the solver plays at least half the time. */
function rangeToMajority(text) {
  return parseRange(text)
    .filter(([, w]) => w >= 0.5)
    .map(([h]) => h)
    .join(",");
}

// ---------------------------------------------------------------- parsing

/**
 * Turn one leaf directory into a preflop line, or return null when the
 * directory does not look like a solved terminal node.
 */
function readLine(dir, relPath) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const rangeFiles = entries.filter(
    (e) => e.isFile() && e.name.endsWith("_range.txt"),
  );
  if (rangeFiles.length === 0) return null;

  const segments = relPath.split(path.sep).filter(Boolean);
  if (segments.length < 2 || segments.length % 2 !== 0) return null;

  const pairs = [];
  for (let i = 0; i < segments.length; i += 2) {
    pairs.push({ seat: segments[i], action: segments[i + 1] });
  }
  if (!PREFLOP_ORDER.includes(pairs[0].seat)) return null;

  const live = rangeFiles.map((e) => e.name.replace("_range.txt", ""));
  const ranges = {};
  for (const seat of live) {
    const text = fs.readFileSync(path.join(dir, `${seat}_range.txt`), "utf8").trim();
    ranges[seat] = {
      raw: text,
      labels: rangeToLabels(text),
      majority: rangeToMajority(text),
    };
  }

  const allIn = pairs.some((p) => p.action === "AllIn") ||
    pairs.some((p) => parseSize(p.action) !== null && parseSize(p.action) >= STACK_BB);

  // --- pot accounting: replay the action in preflop order -------------
  let committed = 0;
  const put = {};
  for (const seat of PREFLOP_ORDER) put[seat] = 0;
  for (const seat of Object.keys(BLINDS)) put[seat] = BLINDS[seat];

  const bySeat = new Map();
  for (const p of pairs) {
    if (!bySeat.has(p.seat)) bySeat.set(p.seat, []);
    bySeat.get(p.seat).push(p.action);
  }

  let maxTo = BLINDS.BB;
  for (const seat of PREFLOP_ORDER) {
    const actions = bySeat.get(seat) ?? [];
    if (actions.length === 0) continue; // folded without acting -> blind only
    for (const a of actions) {
      const size = parseSize(a);
      if (size !== null) {
        put[seat] = size;
        maxTo = Math.max(maxTo, size);
      } else if (a === "Call") {
        put[seat] = maxTo;
      } else if (a === "AllIn") {
        put[seat] = STACK_BB;
        maxTo = STACK_BB;
      }
      // "Fold" leaves the seat's earlier contribution (its blind) in the pot
    }
  }
  for (const seat of PREFLOP_ORDER) committed += put[seat];

  const headsUp = live.length === 2;
  const flopReachable = headsUp && !allIn;

  const [first, second] = headsUp
    ? live.slice().sort((a, b) => POSTFLOP_ORDER.indexOf(a) - POSTFLOP_ORDER.indexOf(b))
    : [null, null];

  return {
    id: slugify(relPath),
    path: segments.join("/"),
    openSeat: pairs[0].seat,
    actions: pairs.map((p) => ({
      seat: p.seat,
      action: p.action,
      to: parseSize(p.action),
    })),
    live,
    headsUp,
    flopReachable,
    oop: first,
    ip: second,
    potBb: round2(committed),
    effStackBb: round2(STACK_BB - maxTo),
    ranges,
    label: describe(pairs),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** "BTN opens 2.5bb; SB folds; BB raises to 11bb; BTN calls" */
function describe(pairs) {
  let opened = false;
  return pairs
    .map((p) => {
      const size = parseSize(p.action);
      if (size !== null) {
        if (!opened) {
          opened = true;
          return `${p.seat} opens ${size}bb`;
        }
        return `${p.seat} raises to ${size}bb`;
      }
      if (p.action === "Call") return `${p.seat} calls`;
      if (p.action === "Fold") return `${p.seat} folds`;
      if (p.action === "AllIn") return `${p.seat} all-in`;
      return `${p.seat} ${p.action}`;
    })
    .join("; ");
}

/** Walk the source tree collecting every terminal directory. */
function walk(dir, relPath, out) {
  const line = readLine(dir, relPath);
  if (line) out.push(line);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    walk(path.join(dir, e.name), relPath ? path.join(relPath, e.name) : e.name, out);
  }
}

// ---------------------------------------------------------------- main

function main() {
  const argv = process.argv.slice(2);
  let src = SRC_DEFAULT;
  let out = OUT_DEFAULT;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--src") src = path.resolve(argv[++i]);
    else if (argv[i] === "--out") out = path.resolve(argv[++i]);
    else die(`unknown argument: ${argv[i]}`);
  }
  if (!fs.existsSync(src)) die(`source directory not found: ${src}`);

  const lines = [];
  walk(src, "", lines);
  lines.sort((a, b) => a.id.localeCompare(b.id));

  fs.mkdirSync(out, { recursive: true });
  for (const line of lines) {
    fs.writeFileSync(path.join(out, `${line.id}.json`), JSON.stringify(line, null, 2));
  }
  const index = {
    generatedAt: new Date().toISOString(),
    source: path.relative(ROOT, src).split(path.sep).join("/"),
    stackBb: STACK_BB,
    blinds: BLINDS,
    counts: {
      total: lines.length,
      headsUp: lines.filter((l) => l.headsUp).length,
      flopReachable: lines.filter((l) => l.flopReachable).length,
    },
    lines: lines.map((l) => ({
      id: l.id,
      label: l.label,
      openSeat: l.openSeat,
      oop: l.oop,
      ip: l.ip,
      headsUp: l.headsUp,
      flopReachable: l.flopReachable,
      potBb: l.potBb,
      effStackBb: l.effStackBb,
      actions: l.actions,
      path: l.path,
    })),
  };
  fs.writeFileSync(path.join(out, "index.json"), JSON.stringify(index, null, 2));

  console.log(
    `wrote ${lines.length} preflop lines to ${path.relative(ROOT, out)} ` +
      `(${index.counts.headsUp} heads-up, ${index.counts.flopReachable} reach a flop)`,
  );
}

main();
