import zlib from "node:zlib";
import type Database from "better-sqlite3";
import { RANKS, gridLabel, gridPos, handClass } from "./hands";
import type { ActionInfo, GridCell, HandRow, Kind, NodeResponse, SpotInfo, TrailStep } from "./types";

type SpotRow = {
  spot_id: number; source_file: string; street: string; board: string;
  pos_oop: string; pos_ip: string; pot_bb: number | null; eff_stack_bb: number | null;
};
type NodeRow = { node_id: number; parent_id: number | null; action_path: string; player: "OOP" | "IP" };
type ActRow = {
  action_idx: number; action_raw: string; kind: Kind; amount: number | null; child_path: string | null;
};

const toSpot = (r: SpotRow): SpotInfo => ({
  spotId: r.spot_id, sourceFile: r.source_file, street: r.street, board: r.board,
  posOop: r.pos_oop, posIp: r.pos_ip, potBb: r.pot_bb, effStackBb: r.eff_stack_bb,
});

export function listSpots(db: Database.Database): SpotInfo[] {
  const rows = db.prepare("SELECT * FROM spots ORDER BY spot_id").all() as SpotRow[];
  return rows.map(toSpot);
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
    SELECT a.action_idx, a.action_raw, a.kind, a.amount, c.action_path AS child_path
    FROM node_actions a
    LEFT JOIN nodes c ON c.spot_id = a.spot_id AND c.node_id = a.child_node_id
    WHERE a.spot_id = ? AND a.node_id = ? ORDER BY a.action_idx`);

  const node = nodeByPath.get(spotId, path) as NodeRow | undefined;
  if (!node) return null;

  const actionsOf = (nodeId: number): ActionInfo[] =>
    (actionsStmt.all(spotId, nodeId) as ActRow[]).map((a) => ({
      idx: a.action_idx, raw: a.action_raw, kind: a.kind, amount: a.amount,
      label: labelFor(a.kind, a.amount, spot.effStackBb), childPath: a.child_path,
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
