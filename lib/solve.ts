import zlib from "node:zlib";
import type Database from "better-sqlite3";
import { RANKS, gridLabel, gridPos, handClass } from "./hands";
import { readPreflopIndex, type PreflopLineSummary } from "./preflop";
import type { ActionInfo, ChainSegment, GridCell, HandRow, Kind, NodeResponse, SpotGroup, SpotInfo, TrailStep } from "./types";

type SpotRow = {
  spot_id: number; source_file: string; street: string; board: string;
  pos_oop: string; pos_ip: string; pot_bb: number | null; eff_stack_bb: number | null;
  parent_spot_id: number | null; parent_path: string | null; dealt_card: string | null;
};
type NodeRow = { node_id: number; parent_id: number | null; action_path: string; player: "OOP" | "IP" };
type ActRow = {
  action_idx: number; action_raw: string; kind: Kind; amount: number | null;
  child_path: string | null; child_type: string | null;
};

// Preflop lines are keyed by the (OOP, IP, pot) they produce; the chart index
// has exactly one line per combination, so a spot's line is derivable.
let lineIndex: Map<string, PreflopLineSummary> | null = null;

function lineFor(posOop: string, posIp: string, potBb: number | null): PreflopLineSummary | null {
  if (potBb == null) return null;
  lineIndex ??= new Map(
    (readPreflopIndex()?.lines ?? [])
      .filter((l) => l.oop && l.ip)
      .map((l) => [`${l.oop}|${l.ip}|${l.potBb}`, l]),
  );
  return lineIndex.get(`${posOop}|${posIp}|${potBb}`) ?? null;
}

const toSpot = (r: SpotRow): SpotInfo => {
  const line = lineFor(r.pos_oop, r.pos_ip, r.pot_bb);
  return {
    spotId: r.spot_id, sourceFile: r.source_file, street: r.street, board: r.board,
    posOop: r.pos_oop, posIp: r.pos_ip, potBb: r.pot_bb, effStackBb: r.eff_stack_bb,
    flop: r.board.slice(0, 6),
    lineId: line?.id ?? null,
    lineLabel: line?.label ?? null,
    parentSpotId: r.parent_spot_id ?? null,
    parentPath: r.parent_path ?? null,
    dealtCard: r.dealt_card ?? null,
  };
};

/** The spot a continuation grew out of: same seats, one card less on the board. */
function ancestorOf(s: SpotInfo, byBoard: Map<string, SpotInfo>): SpotInfo | null {
  if (s.street === "flop") return null;
  return byBoard.get(`${s.posOop}|${s.posIp}|${s.board.slice(0, -2)}`.toLowerCase()) ?? null;
}

export function listSpots(db: Database.Database): SpotInfo[] {
  const rows = db.prepare("SELECT * FROM spots ORDER BY spot_id").all() as SpotRow[];
  const spots = rows.map(toSpot);

  // A turn/river spot starts with a postflop pot, so it cannot be matched to a
  // preflop line by pot size. Inherit the line from the spot it was continued
  // from instead (boards of a continuation are prefixes of each other).
  const byBoard = new Map(spots.map((s) => [`${s.posOop}|${s.posIp}|${s.board}`.toLowerCase(), s]));
  for (const s of spots) {
    let cur = s;
    for (let guard = 0; guard < 4; guard++) {
      const parent = ancestorOf(cur, byBoard);
      if (!parent) break;
      cur = parent;
    }
    if (cur !== s && cur.lineId) {
      s.lineId = cur.lineId;
      s.lineLabel = cur.lineLabel;
    }
  }
  return spots;
}

/**
 * Continuation chain of a spot, oldest first: each segment carries the trail of
 * an ancestor up to the node where the next card was dealt, plus that card.
 * Rendered by the viewer so the whole hand stays on screen while you deal.
 */
export function listAncestors(db: Database.Database, spotId: number): ChainSegment[] {
  const byId = db.prepare("SELECT * FROM spots WHERE spot_id = ?");
  const nodeAt = db.prepare(
    "SELECT node_id, parent_id, node_type, action_path FROM nodes WHERE spot_id = ? AND action_path = ?",
  );
  const nodeById = db.prepare("SELECT action_path FROM nodes WHERE spot_id = ? AND node_id = ?");
  const closingIdx = db.prepare(
    "SELECT action_idx FROM node_actions WHERE spot_id = ? AND child_node_id = ?",
  );

  /**
   * Trail of `parent` up to the decision that closed the street, with that
   * action marked as taken. `path` is the chance node recorded by the
   * continuation (older rows may hold the decision node instead).
   */
  const trailAt = (parentId: number, path: string): TrailStep[] | null => {
    const node = nodeAt.get(parentId, path ?? "") as
      | { node_id: number; parent_id: number | null; node_type: string }
      | undefined;
    if (!node) return null;

    let decisionPath: string | null = null;
    let taken: number | null = null;
    if (node.node_type === "action") {
      decisionPath = path;
    } else if (node.parent_id != null) {
      decisionPath = (nodeById.get(parentId, node.parent_id) as { action_path: string } | undefined)?.action_path ?? null;
      taken = (closingIdx.get(parentId, node.node_id) as { action_idx: number } | undefined)?.action_idx ?? null;
    }
    if (decisionPath == null) return null;
    const trail = buildNodeResponse(db, parentId, decisionPath)?.trail;
    if (!trail?.length) return null;

    const last = trail[trail.length - 1];
    if (taken != null) {
      last.actions = last.actions.map((a, i) => ({ ...a, chosen: i === taken }));
    }
    return trail;
  };

  const segments: ChainSegment[] = [];
  let cur = byId.get(spotId) as SpotRow | undefined;
  for (let guard = 0; cur && cur.parent_spot_id != null && guard < 8; guard++) {
    const parent = byId.get(cur.parent_spot_id) as SpotRow | undefined;
    if (!parent) break;
    const trail = trailAt(parent.spot_id, cur.parent_path ?? "");
    if (trail) {
      segments.unshift({
        spotId: parent.spot_id,
        street: parent.street,
        board: parent.board,
        lineId: toSpot(parent).lineId ?? null,
        trail,
        dealtCard: cur.dealt_card ?? null,
      });
    }
    cur = parent;
  }
  return segments;
}

const STREET_ORDER: Record<string, number> = { flop: 0, turn: 1, river: 2 };

/**
 * Cached solves grouped the way they are played: preflop line -> flop ->
 * the streets solved on that flop. Turn/river spots land in the group of the
 * flop they came from, because every continuation keeps the first three cards.
 */
export function groupSpots(spots: SpotInfo[]): SpotGroup[] {
  const groups = new Map<string, SpotGroup>();
  const byBoard = new Map(spots.map((s) => [`${s.posOop}|${s.posIp}|${s.board}`.toLowerCase(), s]));
  const origin = (s: SpotInfo): SpotInfo => {
    let cur = s;
    for (let guard = 0; guard < 4; guard++) {
      const parent = ancestorOf(cur, byBoard);
      if (!parent) break;
      cur = parent;
    }
    return cur;
  };

  for (const s of spots) {
    const base = origin(s);
    const flop = s.flop ?? s.board.slice(0, 6);
    const key = `${s.lineId ?? `${s.posOop}|${s.posIp}|${base.potBb}`}|${flop}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        lineId: s.lineId ?? null,
        label: s.lineLabel ?? `${s.posOop} vs ${s.posIp} · ${base.potBb ?? "?"}bb pot`,
        flop,
        spots: [],
      };
      groups.set(key, group);
    }
    group.spots.push(s);
  }
  for (const g of groups.values())
    g.spots.sort(
      (a, b) => (STREET_ORDER[a.street] ?? 9) - (STREET_ORDER[b.street] ?? 9) || a.board.localeCompare(b.board),
    );
  return [...groups.values()].sort(
    (a, b) => a.label.localeCompare(b.label) || a.flop.localeCompare(b.flop),
  );
}

const fmt = (n: number) => String(Number(n.toFixed(2)));

function labelFor(kind: Kind, amount: number | null, effStack: number | null): string {
  if (kind === "CHECK") return "Check";
  if (kind === "CALL") return "Call";
  if (kind === "FOLD") return "Fold";
  const allin = effStack != null && amount != null && amount >= effStack;
  return `${allin ? "Allin" : kind === "BET" ? "Bet" : "Raise"} ${fmt(amount ?? 0)}`;
}

// --- caches: combo dictionary + per-spot hand lists never change once imported ---
let comboHands: string[] | null = null;
const handsCache = new Map<string, string[]>();

function loadHands(db: Database.Database, spotId: number, side: "OOP" | "IP"): string[] {
  const key = `${spotId}:${side}`;
  const hit = handsCache.get(key);
  if (hit) return hit;
  comboHands ??= (db.prepare("SELECT hand FROM combos ORDER BY combo_id").all() as { hand: string }[]).map((r) => r.hand);
  const row = db.prepare("SELECT n_hands, combo_ids FROM spot_ranges WHERE spot_id = ? AND side = ?").get(spotId, side) as
    | { n_hands: number; combo_ids: Buffer } | undefined;
  if (!row) throw new Error(`no range for spot ${spotId} ${side}`);
  const hands = Array.from({ length: row.n_hands }, (_, i) => comboHands![row.combo_ids.readUInt16LE(i * 2)]);
  handsCache.set(key, hands);
  return hands;
}

/** Everything the UI needs for one decision node: trail, actions, per-hand + per-cell frequencies. */
export function buildNodeResponse(db: Database.Database, spotId: number, path: string): NodeResponse | null {
  const spotRow = db.prepare("SELECT * FROM spots WHERE spot_id = ?").get(spotId) as SpotRow | undefined;
  if (!spotRow) return null;
  const spot = toSpot(spotRow);

  const nodeByPath = db.prepare("SELECT node_id, parent_id, action_path, player FROM nodes WHERE spot_id = ? AND action_path = ?");
  const nodeById = db.prepare("SELECT node_id, parent_id, action_path, player FROM nodes WHERE spot_id = ? AND node_id = ?");
  const actionsStmt = db.prepare(`
    SELECT a.action_idx, a.action_raw, a.kind, a.amount, c.action_path AS child_path, c.node_type AS child_type
    FROM node_actions a
    LEFT JOIN nodes c ON c.spot_id = a.spot_id AND c.node_id = a.child_node_id
    WHERE a.spot_id = ? AND a.node_id = ? ORDER BY a.action_idx`);

  const node = nodeByPath.get(spotId, path) as NodeRow | undefined;
  if (!node) return null;

  const actionsOf = (nodeId: number): ActionInfo[] =>
    (actionsStmt.all(spotId, nodeId) as ActRow[]).map((a) => ({
      idx: a.action_idx, raw: a.action_raw, kind: a.kind, amount: a.amount,
      label: labelFor(a.kind, a.amount, spot.effStackBb), childPath: a.child_path,
      endsStreet: a.child_type === "chance",
    }));
  const position = (p: "OOP" | "IP") => (p === "OOP" ? spot.posOop : spot.posIp);

  // trail: root -> ... -> this node, each step remembering which action led to the next one
  const chain: NodeRow[] = [];
  for (let cur: NodeRow | undefined = node; cur; ) {
    chain.push(cur);
    cur = cur.parent_id == null ? undefined : (nodeById.get(spotId, cur.parent_id) as NodeRow | undefined);
  }
  chain.reverse();
  const trail: TrailStep[] = chain.map((n, k) => ({
    path: n.action_path,
    player: n.player,
    position: position(n.player),
    actions: actionsOf(n.node_id).map((a) => ({
      label: a.label, kind: a.kind, amount: a.amount, childPath: a.childPath,
      endsStreet: a.endsStreet,
      chosen: chain[k + 1] !== undefined && a.childPath === chain[k + 1].action_path,
    })),
  }));

  // strategy blob: uint8 [n_actions][n_hands], zlib, each hand's column sums to 255
  const actions = actionsOf(node.node_id);
  const hands = loadHands(db, spotId, node.player);
  const nh = hands.length;
  const blob = db.prepare("SELECT encoding, strategy FROM node_strategy WHERE spot_id = ? AND node_id = ?").get(spotId, node.node_id) as
    | { encoding: string; strategy: Buffer } | undefined;
  if (!blob) return null;
  if (blob.encoding !== "u8_actionmajor_zlib") throw new Error(`unsupported encoding ${blob.encoding}`);
  const raw = zlib.inflateSync(blob.strategy);
  if (raw.length !== actions.length * nh) throw new Error("strategy blob size mismatch");
  const freq = (a: number, h: number) => raw[a * nh + h] / 255;

  const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
  const handRows: HandRow[] = hands.map((hand, h) => ({
    hand, cls: handClass(hand), freqs: actions.map((_, a) => r4(freq(a, h))),
  }));

  // 13x13 grid: average each class's combos
  const sums = Array.from({ length: 13 }, () => Array.from({ length: 13 }, () => ({ n: 0, f: actions.map(() => 0) })));
  for (const hr of handRows) {
    const [r, c] = gridPos(hr.cls);
    const cell = sums[r][c];
    cell.n++;
    hr.freqs.forEach((f, a) => (cell.f[a] += f));
  }
  const grid: GridCell[][] = sums.map((row, r) =>
    row.map((cell, c) => ({
      label: gridLabel(r, c), combos: cell.n, freqs: cell.f.map((f) => r4(cell.n ? f / cell.n : 0)),
    })),
  );

  // whole-range summary. NOTE: the solver JSON has no range weights, so every listed combo counts as 1.
  const summary = actions.map((_, a) => {
    let combos = 0;
    for (let h = 0; h < nh; h++) combos += freq(a, h);
    return { combos: Math.round(combos * 100) / 100, freq: r4(combos / nh) };
  });

  return {
    spot,
    node: { nodeId: node.node_id, path: node.action_path, player: node.player, position: position(node.player), actions },
    trail, nHands: nh, summary, grid, hands: handRows,
  };
}

export { RANKS };
