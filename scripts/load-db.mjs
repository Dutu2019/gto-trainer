// Parse every raw solver output and load the normalized strategies into SQLite
// (data/gto.db). Schema: spots -> nodes -> strategies.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { spots, matchups } from "./spots.config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const DB_PATH = path.join(ROOT, "data", "gto.db");

const DDL = `
CREATE TABLE IF NOT EXISTS spots (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  matchup       TEXT NOT NULL,
  street        TEXT NOT NULL,
  board         TEXT NOT NULL,
  pot           REAL NOT NULL,
  effective_stack REAL NOT NULL,
  oop_position  TEXT NOT NULL,
  ip_position   TEXT NOT NULL,
  oop_range     TEXT NOT NULL,
  ip_range      TEXT NOT NULL,
  solver        TEXT NOT NULL,
  exploitability REAL,
  created_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  spot_id      TEXT NOT NULL REFERENCES spots(id),
  node_key     TEXT NOT NULL,
  street       TEXT NOT NULL,
  board        TEXT NOT NULL,
  actor        TEXT NOT NULL,
  action_json  TEXT NOT NULL,
  history      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS strategies (
  node_id      INTEGER NOT NULL REFERENCES nodes(id),
  hand         TEXT NOT NULL,
  action_index INTEGER NOT NULL,
  freq         REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nodes_spot    ON nodes(spot_id);
CREATE INDEX IF NOT EXISTS idx_nodes_actor   ON nodes(actor);
CREATE INDEX IF NOT EXISTS idx_strat_node    ON strategies(node_id);
CREATE INDEX IF NOT EXISTS idx_strat_node_hand ON strategies(node_id, hand);
`;

function exploitabilityFromLog(file) {
  if (!fs.existsSync(file)) return null;
  const log = fs.readFileSync(file, "utf8");
  const m = [...log.matchAll(/Total exploitability\s+([\d.]+)/g)];
  return m.length ? Number(m[m.length - 1][1]) : null;
}

function handCards(hand) {
  // "AcKc" -> ["Ac", "Kc"]
  return [hand.slice(0, 2), hand.slice(2, 4)];
}

function loadSpot(db, spot, insertNode, insertStrategy) {
  const rawFile = path.join(RAW_DIR, `${spot.id}.json`);
  if (!fs.existsSync(rawFile)) throw new Error(`missing ${rawFile}`);
  const root = JSON.parse(fs.readFileSync(rawFile, "utf8"));
  const positions = matchups[spot.matchup];
  const baseBoard = spot.board.split(",");

  db.prepare(
    `INSERT INTO spots (id,name,matchup,street,board,pot,effective_stack,
       oop_position,ip_position,oop_range,ip_range,solver,exploitability,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    spot.id,
    spot.id,
    spot.matchup,
    spot.street,
    spot.board,
    spot.pot,
    spot.effectiveStack,
    positions.oop,
    positions.ip,
    "",
    "",
    "TexasSolver v0.2.0",
    exploitabilityFromLog(path.join(RAW_DIR, `${spot.id}.log`)),
    new Date().toISOString(),
  );

  let nodeCount = 0;
  let stratCount = 0;

  function walk(node, street, board, history) {
    if (!node || typeof node !== "object") return;

    if (node.node_type === "chance_node") {
      const nextStreet = street === "turn" ? "river" : street;
      for (const card of Object.keys(node.dealcards || {})) {
        walk(node.dealcards[card], nextStreet, [...board, card], [...history, `deal:${card}`]);
      }
      return;
    }

    if (node.node_type !== "action_node") return;

    if (node.strategy && node.strategy.strategy && Array.isArray(node.actions)) {
      const actor = node.player === 1 ? "OOP" : "IP";
      const historyKey = history.join("|") || "ROOT";
      const info = insertNode.run(
        spot.id,
        historyKey,
        street,
        board.join(","),
        actor,
        JSON.stringify(node.actions),
        history.join("|"),
      );
      const nodeId = Number(info.lastInsertRowid);
      nodeCount++;

      const boardSet = new Set(board);
      for (const [hand, freqs] of Object.entries(node.strategy.strategy)) {
        if (hand.length < 4) continue;
        const [c1, c2] = handCards(hand);
        if (boardSet.has(c1) || boardSet.has(c2)) continue; // impossible combo
        for (let i = 0; i < node.actions.length; i++) {
          const f = freqs[i] ?? 0;
          if (f > 0) {
            insertStrategy.run(nodeId, hand, i, f);
            stratCount++;
          }
        }
      }
    }

    for (const key of Object.keys(node.childrens || {})) {
      walk(node.childrens[key], street, board, [...history, key]);
    }
  }

  walk(root, spot.street, baseBoard, []);
  return { nodeCount, stratCount };
}

const db = new DatabaseSync(DB_PATH);
db.exec(DDL);
db.exec("DELETE FROM strategies; DELETE FROM nodes; DELETE FROM spots;");

const insertNode = db.prepare(
  `INSERT INTO nodes (spot_id,node_key,street,board,actor,action_json,history)
   VALUES (?,?,?,?,?,?,?)`,
);
const insertStrategy = db.prepare(
  `INSERT INTO strategies (node_id,hand,action_index,freq) VALUES (?,?,?,?)`,
);

db.exec("BEGIN");
try {
  for (const spot of spots) {
    const { nodeCount, stratCount } = loadSpot(db, spot, insertNode, insertStrategy);
    console.log(`${spot.id}: ${nodeCount} nodes, ${stratCount} strategy rows`);
  }
  db.exec("COMMIT");
} catch (err) {
  db.exec("ROLLBACK");
  throw err;
}

const totals = db
  .prepare("SELECT COUNT(*) AS n FROM strategies")
  .get();
const actorSplit = db
  .prepare("SELECT actor, COUNT(*) AS n FROM nodes GROUP BY actor")
  .all();
console.log(`\nloaded ${totals.n} strategy rows`);
console.log("nodes by actor:", actorSplit);
db.close();
console.log(`database: ${path.relative(ROOT, DB_PATH)}`);
