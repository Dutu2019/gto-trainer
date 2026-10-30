// The preflop chart as a clickable decision tree.
//
// data/preflop/index.json holds 424 solved *lines* (seat/action sequences), not
// a tree: a seat that folds before ever acting is simply absent, so the same
// prefix can be followed by different seats depending on who folded. This module
// re-expands every line into a full action sequence (inserting those implicit
// folds in 6-max order), then folds the sequences into a trie keyed by
// `<seat>/<action>/...` so the viewer can walk it node by node.
//
// The trie is rebuilt only when index.json changes.
import fs from "node:fs";
import path from "node:path";
import { PREFLOP_DIR, readPreflopIndex, type PreflopAction, type PreflopLineSummary } from "./preflop";
import type { Kind, PreflopLeaf, PreflopNode, PreflopOption, TrailStep } from "./types";

/** 6-max acting order; the preflop root is always UTG. */
const ORDER = ["UTG", "MP", "CO", "BTN", "SB", "BB"];

type RawNode = {
  seat: string | null;
  /** Action tokens available here (all for `seat`). */
  actions: Set<string>;
  lineId: string | null;
};

type Tree = {
  nodes: Map<string, RawNode>;
  lines: Map<string, PreflopLineSummary>;
  linePath: Map<string, string>;
  stamp: number;
};

// ---------------------------------------------------------------- expansion

/**
 * Fill in the folds the chart leaves implicit.
 *
 * The recorded sequence names only the seats that acted; every seat between the
 * previous actor and the next one folded. Starting from UTG also inserts the
 * folds before the opener (a BTN-open line begins UTG/Fold, MP/Fold, CO/Fold).
 */
export function expandLine(actions: PreflopAction[]): PreflopAction[] {
  const out: PreflopAction[] = [];
  let i = 0;
  for (const a of actions) {
    const target = ORDER.indexOf(a.seat);
    if (target < 0) continue;
    for (let guard = 0; guard < ORDER.length && i !== target; guard++) {
      out.push({ seat: ORDER[i], action: "Fold", to: null });
      i = (i + 1) % ORDER.length;
    }
    out.push({ seat: a.seat, action: a.action, to: a.to });
    i = (target + 1) % ORDER.length;
  }
  return out;
}

// ---------------------------------------------------------------- the trie

let cache: Tree | null = null;

function indexStamp(): number {
  try {
    return fs.statSync(path.join(PREFLOP_DIR, "index.json")).mtimeMs;
  } catch {
    return 0;
  }
}

function getTree(): Tree {
  const stamp = indexStamp();
  if (cache && cache.stamp === stamp) return cache;

  const nodes = new Map<string, RawNode>();
  const lines = new Map<string, PreflopLineSummary>();
  const linePath = new Map<string, string>();
  const node = (p: string): RawNode => {
    let n = nodes.get(p);
    if (!n) {
      n = { seat: null, actions: new Set(), lineId: null };
      nodes.set(p, n);
    }
    return n;
  };
  node("");

  for (const line of readPreflopIndex()?.lines ?? []) {
    const steps = expandLine(line.actions);
    if (!steps.length) continue;
    lines.set(line.id, line);

    let p = "";
    for (const step of steps) {
      const cur = node(p);
      cur.seat = step.seat;
      cur.actions.add(step.action);
      p = p ? `${p}/${step.seat}/${step.action}` : `${step.seat}/${step.action}`;
    }
    node(p).lineId = line.id;
    linePath.set(line.id, p);
  }

  cache = { nodes, lines, linePath, stamp };
  return cache;
}

function childPath(parent: string, seat: string, action: string): string {
  return parent ? `${parent}/${seat}/${action}` : `${seat}/${action}`;
}

/** Chart token order: sizes ascending, all-in, call, fold. */
function rank(action: string): number {
  const m = /^([0-9]+(?:\.[0-9]+)?)bb$/.exec(action);
  if (m) return Number(m[1]);
  if (action === "AllIn") return 1000;
  if (action === "Call") return 2000;
  if (action === "Fold") return 3000;
  return 4000;
}

function describe(action: string): { label: string; kind: Kind; amount: number | null } {
  const m = /^([0-9]+(?:\.[0-9]+)?)bb$/.exec(action);
  if (m) return { label: `Raise ${Number(m[1])}`, kind: "RAISE", amount: Number(m[1]) };
  if (action === "Call") return { label: "Call", kind: "CALL", amount: null };
  if (action === "Fold") return { label: "Fold", kind: "FOLD", amount: null };
  if (action === "AllIn") return { label: "Allin", kind: "RAISE", amount: null };
  return { label: action, kind: "RAISE", amount: null };
}

function optionsOf(t: Tree, p: string): PreflopOption[] {
  const node = t.nodes.get(p);
  if (!node || !node.seat) return [];
  return [...node.actions]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((action) => ({ action, ...describe(action), path: childPath(p, node.seat as string, action) }));
}

/** Path to a node, split into seat/action pairs. */
function pairs(p: string): string[] {
  return p ? p.split("/") : [];
}

function nodeAt(t: Tree, p: string): PreflopNode {
  const node = t.nodes.get(p);
  const seat = node?.seat ?? null;
  return {
    path: p,
    seat,
    options: optionsOf(t, p),
    trail: trailFor(t, p),
    leaf: leafOf(t, p),
  };
}

function trailFor(t: Tree, p: string): TrailStep[] {
  const parts = pairs(p);
  const steps: TrailStep[] = [];
  let cur = "";
  for (let i = 0; i < parts.length; i += 2) {
    const seat = parts[i];
    const action = parts[i + 1];
    const options = optionsOf(t, cur);
    if (options.length) {
      steps.push({
        path: cur,
        player: "",
        position: t.nodes.get(cur)?.seat ?? seat,
        actions: options.map((o) => ({
          label: o.label,
          kind: o.kind,
          amount: o.amount,
          childPath: o.path,
          endsStreet: false,
          chosen: o.action === action,
        })),
      });
    }
    cur = childPath(cur, seat, action);
  }
  // The node being viewed: its branches are the ones the user can click next.
  const current = optionsOf(t, p);
  if (current.length) {
    steps.push({
      path: p,
      player: "",
      position: t.nodes.get(p)?.seat ?? "",
      actions: current.map((o) => ({
        label: o.label,
        kind: o.kind,
        amount: o.amount,
        childPath: o.path,
        endsStreet: false,
        chosen: false,
      })),
    });
  }
  return steps;
}

function leafOf(t: Tree, p: string): PreflopLeaf | null {
  const id = t.nodes.get(p)?.lineId;
  if (!id) return null;
  const line = t.lines.get(id);
  if (!line) return null;
  const allIn = line.effStackBb <= 0 || line.actions.some((a) => a.action === "AllIn");
  const reason = allIn
    ? "the stack goes in preflop — there is no flop to solve"
    : !line.headsUp
      ? "more than two players reach this flop — the solver is heads-up only"
      : line.flopReachable
        ? null
        : "this line cannot reach a flop";  return {
    lineId: line.id,
    label: line.label,
    potBb: line.potBb,
    effStackBb: line.effStackBb,
    oop: line.oop,
    ip: line.ip,
    solvable: line.flopReachable,
    reason,
  };
}

// ---------------------------------------------------------------- public API

/** Normalise a client-supplied path ('/UTG//2.5bb/' -> 'UTG/2.5bb'). */
function normalise(p: string): string {
  return p
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean)
    .join("/");
}

export function preflopNode(pathParam: string): PreflopNode | null {
  const t = getTree();
  const p = normalise(pathParam ?? "");
  if (!t.nodes.has(p)) return null;
  return nodeAt(t, p);
}

/** The terminal node of one chart line (used to show a solved spot's history). */
export function preflopNodeForLine(lineId: string): PreflopNode | null {
  const t = getTree();
  const p = t.linePath.get(lineId);
  return p == null ? null : nodeAt(t, p);
}
