// Continuing a solved street into the next one.
//
// A solve dumps only the street it starts on (`set_dump_rounds 1`), so an action
// that closes the betting round points at a chance node with nothing below it.
// Continuing means building a new spot whose root is that chance node:
//
//   reach(side, hand) = product of that side's action frequencies along the path
//   pot               = pot + 2 * (chips each player put in on that street)
//   effective stack   = stack - chips put in on that street
//
// The solver's input format only understands hand *classes* (`AA`, `AKs`,
// `AKo`); src/tools/PrivateRangeConverter.cpp rejects 4-char combos. So each
// class takes the mean reach of its combos that the new board card does not
// block — total mass is preserved, suit-level blocker detail is averaged.
import zlib from "node:zlib";
import { getDb } from "./db";
import { CARD_RE, spotStem, type SpotConfig, type Street } from "./solver-input";

const NEXT: Record<string, Street | null> = { flop: "turn", turn: "river", river: null };

const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const SUITS = ["s", "h", "d", "c"];
/** All 52 cards, in the same order the pickers use. */
export const ALL_CARDS = SUITS.flatMap((s) => RANKS.map((r) => `${r}${s}`));

export function nextStreet(street: string): Street | null {
  return NEXT[street] ?? null;
}

type SpotRow = {
  spot_id: number;
  source_file: string;
  street: Street;
  board: string;
  pos_oop: string;
  pos_ip: string;
  pot_bb: number | null;
  eff_stack_bb: number | null;
};

type NodeRow = { node_id: number; parent_id: number | null; action_path: string; node_type: string; player: string | null };

type ActionRow = {
  action_idx: number;
  action_raw: string;
  kind: string;
  amount: number | null;
  child_node_id: number | null;
};

export type CardOption = {
  card: string;
  /** Already solved for this line + board card. */
  spotId: number | null;
  /** Impossible: the card is already on the board. */
  blocked: boolean;
};

export type DealTarget = {
  /** Street the new spot would start on. */
  street: Street;
  potBb: number;
  effStackBb: number;
  board: string;
  cards: CardOption[];
};

export type BuiltContinuation = {
  cfg: SpotConfig;
  stem: string;
  street: Street;
  board: string;
  label: string;
  /** Normalised card that starts the new street. */
  card: string;
};

export type BuildResult =
  | { ok: true; built: BuiltContinuation }
  | { ok: false; error: string; status: number };

// ------------------------------------------------------------------ plumbing

function getSpot(spotId: number): SpotRow | null {
  const row = getDb()
    .prepare(
      "SELECT spot_id, source_file, street, board, pos_oop, pos_ip, pot_bb, eff_stack_bb FROM spots WHERE spot_id = ?",
    )
    .get(spotId) as SpotRow | undefined;
  return row ?? null;
}

function actionsOf(spotId: number, nodeId: number): ActionRow[] {
  return getDb()
    .prepare(
      `SELECT action_idx, action_raw, kind, amount, child_node_id
         FROM node_actions WHERE spot_id = ? AND node_id = ? ORDER BY action_idx`,
    )
    .all(spotId, nodeId) as ActionRow[];
}

function getNode(spotId: number, nodeId: number): NodeRow | null {
  const row = getDb()
    .prepare(
      "SELECT node_id, parent_id, action_path, node_type, player FROM nodes WHERE spot_id = ? AND node_id = ?",
    )
    .get(spotId, nodeId) as NodeRow | undefined;
  return row ?? null;
}

function nodeByPath(spotId: number, path: string): NodeRow | null {
  const row = getDb()
    .prepare(
      "SELECT node_id, parent_id, action_path, node_type, player FROM nodes WHERE spot_id = ? AND action_path = ?",
    )
    .get(spotId, path) as NodeRow | undefined;
  return row ?? null;
}

/** root .. node, following parent_id. */
function chainTo(spotId: number, nodeId: number): NodeRow[] | null {
  const out: NodeRow[] = [];
  for (let cur: NodeRow | null = getNode(spotId, nodeId); cur; ) {
    out.push(cur);
    cur = cur.parent_id == null ? null : getNode(spotId, cur.parent_id);
  }
  return out.length ? out.reverse() : null;
}

/**
 * Frequency of `action` for every hand at a node, indexed like spot_ranges.
 *
 * Blob layout (scripts/import-solve.js): uint8 [n_actions][n_hands],
 * action-major, zlib, no header — dimensions come from nodes.n_actions and the
 * acting side's spot_ranges row.
 */
function strategyFreq(
  spotId: number,
  nodeId: number,
  action: number,
  nHands: number,
): Float64Array | null {
  const row = getDb()
    .prepare("SELECT strategy FROM node_strategy WHERE spot_id = ? AND node_id = ?")
    .get(spotId, nodeId) as { strategy: Buffer } | undefined;
  if (!row) return null;
  const meta = getDb()
    .prepare("SELECT n_actions FROM nodes WHERE spot_id = ? AND node_id = ?")
    .get(spotId, nodeId) as { n_actions: number } | undefined;
  const nActions = meta?.n_actions ?? 0;
  if (!nActions || action >= nActions) return null;

  const raw = zlib.inflateSync(row.strategy);
  if (raw.length !== nActions * nHands) return null;
  const out = new Float64Array(nHands);
  for (let h = 0; h < nHands; h++) out[h] = raw[action * nHands + h] / 255;
  return out;
}

/** The exact combos in one side's range, in strategy-column order. */
function rangeHands(spotId: number, side: "OOP" | "IP"): string[] {
  const row = getDb()
    .prepare("SELECT n_hands, combo_ids FROM spot_ranges WHERE spot_id = ? AND side = ?")
    .get(spotId, side) as { n_hands: number; combo_ids: Buffer } | undefined;
  if (!row) return [];
  const ids = new Uint16Array(row.combo_ids.buffer, row.combo_ids.byteOffset, row.n_hands);
  const names = new Map(
    (
      getDb().prepare("SELECT combo_id, hand FROM combos").all() as {
        combo_id: number;
        hand: string;
      }[]
    ).map((c) => [c.combo_id, c.hand]),
  );
  return [...ids].map((id) => names.get(id) ?? "");
}

/** "As Kd" -> "AKo"; pairs keep just the rank ("AA"). */
function handClass(hand: string): string {
  const h = hand.trim();
  if (h[0] === h[2]) return `${h[0]}${h[2]}`;
  return `${h[0]}${h[2]}${h[1] === h[3] ? "s" : "o"}`;
}

/** Mean reach per hand class, dropping classes the board has blocked out. */
function rangeFromReach(hands: string[], reach: Float64Array, blocked: Set<string>): string {
  const acc = new Map<string, { sum: number; n: number }>();
  hands.forEach((hand, i) => {
    const h = hand.trim();
    if (h.length < 4) return;
    if (blocked.has(h.slice(0, 2)) || blocked.has(h.slice(2, 4))) return;
    const cls = handClass(h);
    const a = acc.get(cls) ?? { sum: 0, n: 0 };
    a.sum += reach[i] ?? 0;
    a.n += 1;
    acc.set(cls, a);
  });
  const parts: string[] = [];
  for (const [cls, a] of acc) {
    const w = a.sum / a.n;
    if (w >= 0.005) parts.push(`${cls}:${w.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`);
  }
  return parts.join(",");
}

// ------------------------------------------------------------- reach & prices

type StreetEnd = {
  spot: SpotRow;
  /** Chance node the action points at, i.e. where the next street begins. */
  chanceNode: NodeRow;
  street: Street;
  reach: { OOP: Float64Array; IP: Float64Array };
  invested: number;
  potBb: number;
  effStackBb: number;
};

/**
 * Reach, pot and stack at the chance node named by `path`. `path` is the
 * action path of the chance node itself (as returned by node_actions.child).
 */
function streetEnd(spotId: number, path: string): { ok: true; end: StreetEnd } | { ok: false; error: string; status: number } {
  const spot = getSpot(spotId);
  if (!spot) return { ok: false, error: `unknown spot #${spotId}`, status: 404 };

  const street = nextStreet(spot.street);
  if (!street)
    return { ok: false, error: "the river is the last street — nothing left to solve", status: 400 };
  if (spot.pot_bb == null || spot.eff_stack_bb == null)
    return { ok: false, error: "this spot has no pot/stack metadata", status: 400 };

  const node = nodeByPath(spotId, path ?? "");
  if (!node) return { ok: false, error: `no node at path '${path}'`, status: 404 };
  if (node.node_type !== "chance")
    return {
      ok: false,
      error: `'${path}' is a decision node — deal the next card after an action that closes the street`,
      status: 400,
    };

  const chain = chainTo(spotId, node.node_id);
  if (!chain) return { ok: false, error: "broken tree", status: 500 };

  const oopHands = rangeHands(spotId, "OOP");
  const ipHands = rangeHands(spotId, "IP");
  const reach = {
    OOP: new Float64Array(oopHands.length).fill(1),
    IP: new Float64Array(ipHands.length).fill(1),
  };

  let invested = 0;
  for (let i = 1; i < chain.length; i++) {
    const parent = chain[i - 1];
    const child = chain[i];
    if (parent.node_type !== "action" || (parent.player !== "OOP" && parent.player !== "IP")) {
      return { ok: false, error: "broken tree", status: 500 };
    }
    const action = actionsOf(spotId, parent.node_id).find((a) => a.child_node_id === child.node_id);
    if (!action) return { ok: false, error: "broken tree", status: 500 };
    const side = parent.player as "OOP" | "IP";
    const freq = strategyFreq(spotId, parent.node_id, action.action_idx, reach[side].length);
    if (!freq) return { ok: false, error: "stored strategies are missing for that line", status: 500 };
    for (let h = 0; h < reach[side].length; h++) reach[side][h] *= freq[h];
    // The chips each player has committed on this street: a bet/raise is the
    // total for the street, and the caller matches it.
    if ((action.kind === "BET" || action.kind === "RAISE") && action.amount != null)
      invested = Math.max(invested, action.amount);
  }

  // A call closes the street when the previous action was a bet; a check-check
  // or a raise-call leaves the same number behind for both players.
  const effStackBb = round2(spot.eff_stack_bb - invested);
  if (effStackBb <= 0)
    return { ok: false, error: "that line is all-in — there is no next street", status: 400 };

  const from = node.parent_id == null ? null : getNode(spotId, node.parent_id);
  if (!from) return { ok: false, error: "broken tree", status: 500 };

  return {
    ok: true,
    end: {
      spot,
      chanceNode: node,
      street,
      reach,
      invested,
      potBb: round2(spot.pot_bb + 2 * invested),
      effStackBb,
    },
  };
}

// ------------------------------------------------------------------ public API

/** What the viewer needs to render the "deal the next card" picker. */
export function dealTarget(
  spotId: number,
  path: string,
): { ok: true; target: DealTarget } | { ok: false; error: string; status: number } {
  const res = streetEnd(spotId, path);
  if (!res.ok) return res;
  const { end } = res;

  const board: string[] = end.spot.board.match(/[2-9TJQKA][shdc]/gi) ?? [];
  const nextBoardPrefix = [...board].join("");
  const solved = getDb()
    .prepare("SELECT spot_id, board, pot_bb, eff_stack_bb FROM spots WHERE street = ?")
    .all(end.street) as {
    spot_id: number;
    board: string;
    pot_bb: number | null;
    eff_stack_bb: number | null;
  }[];

  const cards: CardOption[] = ALL_CARDS.map((card) => {
    if (board.includes(card)) return { card, spotId: null, blocked: true };
    const boardKey = nextBoardPrefix + card;
    const hit = solved.find(
      (s) =>
        s.board === boardKey &&
        s.pot_bb != null &&
        Math.abs(s.pot_bb - end.potBb) < 0.01 &&
        s.eff_stack_bb != null &&
        Math.abs(s.eff_stack_bb - end.effStackBb) < 0.01,
    );
    return { card, spotId: hit ? hit.spot_id : null, blocked: false };
  });

  return {
    ok: true,
    target: {
      street: end.street,
      potBb: end.potBb,
      effStackBb: end.effStackBb,
      board: nextBoardPrefix,
      cards,
    },
  };
}

/** Solver input + spot identity for "deal `card` at the end of `path`". */
export function buildContinuation(spotId: number, path: string, card: string): BuildResult {
  const res = streetEnd(spotId, path);
  if (!res.ok) return res;
  const { end } = res;

  const given = String(card ?? "").trim();
  const normalised = given.length === 2 ? given[0].toUpperCase() + given[1].toLowerCase() : given;
  if (!CARD_RE.test(normalised))
    return { ok: false, error: `invalid card '${card}'`, status: 400 };
  const board: string[] = end.spot.board.match(/[2-9TJQKA][shdc]/gi) ?? [];
  if (board.includes(normalised))
    return { ok: false, error: `${normalised} is already on the board`, status: 400 };

  const blocked = new Set([...board, normalised]);
  const hands = { OOP: rangeHands(spotId, "OOP"), IP: rangeHands(spotId, "IP") };
  const rangeOop = rangeFromReach(hands.OOP, end.reach.OOP, blocked);
  const rangeIp = rangeFromReach(hands.IP, end.reach.IP, blocked);
  if (!rangeOop || !rangeIp)
    return { ok: false, error: "that line has no reachable hands left", status: 400 };

  const fullBoard = [...board, normalised];
  const cfg: SpotConfig = {
    oop: end.spot.pos_oop,
    ip: end.spot.pos_ip,
    board: fullBoard,
    potBb: end.potBb,
    effStackBb: end.effStackBb,
    rangeOop,
    rangeIp,
  };
  // Identity: this continuation is defined by its parent spot, the node it was
  // dealt from and the card. Hashing that keeps a second continuation from the
  // same board (different node / different line) on its own row.
  const stem = spotStem(
    end.spot.pos_oop,
    end.spot.pos_ip,
    end.street,
    fullBoard.join(""),
    `cont:${end.spot.source_file}:${path}:${normalised}`,
  );
  return {
    ok: true,
    built: {
      cfg,
      stem,
      street: end.street,
      board: fullBoard.join(""),
      label: `${end.spot.pos_oop} vs ${end.spot.pos_ip} · ${end.street} ${normalised}`,
      card: normalised,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
