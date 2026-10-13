#!/usr/bin/env node
// Creates the SQLite database from schema.sql and fills the global `combos` table.
// usage: node create_db.js [gto.db]
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const CARDS = [];
for (const r of RANKS) for (const s of SUITS) CARDS.push(r + s); // card id = rank*4 + suit

// All 1326 combos, higher card first (matches the solver's naming: 'Ts8s', 'TsTc').
export function allCombos() {
  const out = [];
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++)
      out.push([CARDS[b] + CARDS[a], CARDS[b], CARDS[a]]);
  return out;
}

const DB_PATH = path.join(process.cwd(), "data", "gto.db");
export function createDb() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  db.exec(fs.readFileSync(path.join(process.cwd(), "schema.sql"), "utf8"));

  const n = db.prepare("SELECT COUNT(*) AS n FROM combos").get().n;
  if (n === 0) {
    const ins = db.prepare(
      "INSERT INTO combos(combo_id, hand, c1, c2) VALUES (?, ?, ?, ?)",
    );
    db.transaction(() => allCombos().forEach((c, i) => ins.run(i, ...c)))();
  }
  return db;
}

const p = process.argv[2] || "gto.db";
const db = createDb(p);
console.log(
  `created ${p} (${db.prepare("SELECT COUNT(*) AS n FROM combos").get().n} combos)`,
);
db.close();
