#!/usr/bin/env node
// Creates the SQLite database from schema.sql and fills the global `combos` table.
// usage: node create_db.js [gto.db]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const SCHEMA_VERSION = 2;

export const DB_PATH = path.join(process.cwd(), "data", "gto.db");

export function createDb() {
  const db = new Database(DB_PATH);
  db.pragma("foreign_keys = ON");
  const hasNodes = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'nodes'",
    )
    .get();
  if (hasNodes && db.pragma("user_version", { simple: true }) < SCHEMA_VERSION)
    throw new Error(
      `${dbPath} was created with an older schema (needs v${SCHEMA_VERSION}). Delete it and re-import your solves.`,
    );
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

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const p = process.argv[2] || "gto.db";
  const db = createDb(p);
  console.log(
    `created ${p} (${db.prepare("SELECT COUNT(*) AS n FROM combos").get().n} combos)`,
  );
  db.close();
}
