#!/usr/bin/env node
// Import one solver JSON (nested actions/childrens/strategy) into the SQLite schema.
// usage: node import_solve.js solve.json --db gto.db [--board QsJh4d8c3s]
//                             [--oop BB] [--ip BTN] [--pot 6] [--stack 94]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { createDb } from "./create-db.js";

function parseArgs(argv) {
  const a = { json: null, db: null, oop: "BB", ip: "BTN" };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith("--")) {
      a.json = k;
      continue;
    }
    const v = argv[++i];
    if (v === undefined) throw new Error(`missing value for ${k}`);
    a[k.slice(2)] = k === "--pot" || k === "--stack" ? Number(v) : v;
  }
  if (!a.json)
    throw new Error(
      "usage: node import_solve.js solve.json --db gto.db [options]",
    );
  return a;
}

const SHORT = { CHECK: "x", CALL: "c", FOLD: "f", BET: "b", RAISE: "r" };

// 'BET 5.000000' -> { kind:'BET', amount:5, short:'b5' }
export function tok(action) {
  const [kind, amt] = action.split(" ");
  if (!(kind in SHORT)) throw new Error(`unknown action ${action}`);
  const amount = amt === undefined ? null : Number(amt);
  return {
    kind,
    amount,
    short: SHORT[kind] + (amount === null ? "" : String(amount)),
  };
}

// Per-hand probabilities -> per-hand ints summing to 255 (largest remainder).
export function quantize(rows) {
  return rows.map((p) => {
    const raw = p.map((x) => x * 255);
    const fl = raw.map(Math.floor);
    const need = 255 - fl.reduce((s, x) => s + x, 0);
    const order = raw
      .map((_, i) => i)
      .sort((i, j) => raw[j] - fl[j] - (raw[i] - fl[i])); // stable
    for (let k = 0; k < need; k++) fl[order[k]] += 1;
    return fl;
  });
}

export function importSolve(db, file, opts) {
  const base = path.basename(file);
  const m = base.match(/(?:[2-9TJQKA][cdhs]){3,5}/);
  const board = opts.board || (m && m[0]);
  if (!board) throw new Error("board not found in filename; pass --board");

  // street follows from the board (3 = flop, 4 = turn, 5 = river); --street is only a sanity check
  const inferred = { 3: "flop", 4: "turn", 5: "river" }[board.length / 2];
  if (!inferred) throw new Error(`board '${board}' must have 3-5 cards`);
  if (opts.street && opts.street !== inferred)
    throw new Error(
      `--street ${opts.street} contradicts the ${board.length / 2}-card board '${board}' (${inferred})`,
    );
  const street = inferred;

  const root = JSON.parse(fs.readFileSync(file, "utf8"));
  const oopRaw = root.player; // first to act = OOP
  const side = (p) => (p === oopRaw ? "OOP" : "IP");

  const comboId = new Map(
    db
      .prepare("SELECT hand, combo_id FROM combos")
      .all()
      .map((r) => [r.hand, r.combo_id]),
  );

  const insSpot =
    db.prepare(`INSERT INTO spots(source_file,street,board,pos_oop,pos_ip,root_player_raw,pot_bb,eff_stack_bb)
                              VALUES (?,?,?,?,?,?,?,?)`);
  const insNode =
    db.prepare(`INSERT INTO nodes(spot_id,node_id,parent_id,action_in,action_path,depth,node_type,player,n_actions,deal_number)
                              VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const insStrat = db.prepare(
    "INSERT INTO node_strategy(spot_id,node_id,strategy) VALUES (?,?,?)",
  );
  const insSum = db.prepare("INSERT INTO node_summary VALUES (?,?,?)");
  const insAct = db.prepare("INSERT INTO node_actions VALUES (?,?,?,?,?,?,?)");
  const insRange = db.prepare("INSERT INTO spot_ranges VALUES (?,?,?,?)");

  const run = db.transaction(() => {
    // Re-importing the same file replaces its previous rows (children cascade).
    db.prepare("DELETE FROM spots WHERE source_file = ?").run(base);

    const sid = Number(
      insSpot.run(
        base,
        street,
        board,
        opts.oop,
        opts.ip,
        oopRaw,
        opts.pot ?? null,
        opts.stack ?? null,
      ).lastInsertRowid,
    );

    const hands = {}; // side -> hand list (file order)
    let counter = 0;
    const stats = { action: 0, chance: 0 };

    function walk(node, parent, actionIn, p, depth) {
      const nid = counter++;

      if (node.node_type === "chance_node") {
        // Betting round over, next card dealt. The export holds only this stub (deal_number, no children,
        // no strategy), so it is stored as a leaf.
        insNode.run(
          sid,
          nid,
          parent,
          actionIn,
          p,
          depth,
          "chance",
          null,
          0,
          node.deal_number ?? null,
        );
        stats.chance++;
        return nid;
      }
      if (node.node_type !== "action_node")
        throw new Error(`unknown node_type '${node.node_type}' at '${p}'`);
      if (!node.strategy)
        throw new Error(`action node without strategy at '${p}'`);

      const s = side(node.player);
      const strat = node.strategy.strategy;
      const hl = Object.keys(strat);
      if (hands[s] === undefined) hands[s] = hl;
      else if (
        hands[s].length !== hl.length ||
        hands[s].some((h, i) => h !== hl[i])
      )
        throw new Error(`hand list changed at node '${p}'`);

      const acts = node.actions;
      if (JSON.stringify(acts) !== JSON.stringify(node.strategy.actions))
        throw new Error(`action mismatch at node '${p}'`);

      insNode.run(
        sid,
        nid,
        parent,
        actionIn,
        p,
        depth,
        "action",
        s,
        acts.length,
        null,
      );
      stats.action++;

      // strategy blob: uint8 [n_actions][n_hands], action-major
      const q = quantize(hl.map((h) => strat[h]));
      const buf = Buffer.alloc(acts.length * hl.length);
      for (let i = 0; i < acts.length; i++)
        for (let h = 0; h < hl.length; h++) buf[i * hl.length + h] = q[h][i];
      insStrat.run(sid, nid, zlib.deflateSync(buf, { level: 9 }));

      const freq = {};
      acts.forEach((act, i) => {
        freq[act] =
          Math.round(
            (hl.reduce((sum, h) => sum + strat[h][i], 0) / hl.length) * 1e4,
          ) / 1e4;
      });
      insSum.run(sid, nid, JSON.stringify(freq));

      acts.forEach((act, i) => {
        const { kind, amount, short } = tok(act);
        const child = node.childrens && node.childrens[act];
        const childId = child
          ? walk(child, nid, short, (p ? p + "-" : "") + short, depth + 1)
          : null;
        insAct.run(sid, nid, i, act, kind, amount, childId);
      });
      return nid;
    }

    walk(root, null, null, "", 0);

    for (const [s, hl] of Object.entries(hands)) {
      const b = Buffer.alloc(hl.length * 2);
      hl.forEach((h, i) => {
        if (!comboId.has(h)) throw new Error(`unknown hand ${h}`);
        b.writeUInt16LE(comboId.get(h), i * 2);
      });
      insRange.run(sid, s, hl.length, b);
    }
    return { sid, nodes: counter, ...stats };
  });

  return { ...run(), board, street };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  const db = createDb(a.db ?? undefined);
  const r = importSolve(db, a.json, a);
  console.log(
    `spot_id=${r.sid} board=${r.board} street=${r.street} nodes=${r.nodes} (${r.action} action, ${r.chance} chance) db=${db.name}`,
  );
  db.close();
}
