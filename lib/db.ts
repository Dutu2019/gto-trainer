// Server-only data access for the precomputed GTO database (data/gto.db).
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Actor, Answer, Question, SessionFilters } from "./types";

const DB_PATH = path.join(process.cwd(), "data", "gto.db");

let cached: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (!cached) {
    cached = new DatabaseSync(DB_PATH, { readOnly: true });
  }
  return cached;
}

export function dbExists(): boolean {
  return fs.existsSync(DB_PATH);
}

interface NodeRow {
  id: number;
  spot_id: string;
  street: string;
  board: string;
  actor: Actor;
  action_json: string;
  matchup: string;
  pot: number;
  effective_stack: number;
  oop_position: string;
  ip_position: string;
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function getSessionQuestions(filters: SessionFilters): Question[] {
  const count = Math.min(Math.max(filters.count || 20, 1), 100);

  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.matchups?.length) {
    clauses.push(`s.matchup IN (${filters.matchups.map(() => "?").join(",")})`);
    params.push(...filters.matchups);
  }
  if (filters.streets?.length) {
    clauses.push(`n.street IN (${filters.streets.map(() => "?").join(",")})`);
    params.push(...filters.streets);
  }
  if (filters.actors?.length) {
    clauses.push(`n.actor IN (${filters.actors.map(() => "?").join(",")})`);
    params.push(...filters.actors);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const rows = db()
    .prepare(
      `SELECT n.id, n.spot_id, n.street, n.board, n.actor, n.action_json,
              s.matchup, s.pot, s.effective_stack, s.oop_position, s.ip_position
       FROM nodes n
       JOIN spots s ON s.id = n.spot_id
       ${where}`,
    )
    .all(...params) as unknown as NodeRow[];

  const byActor: Record<Actor, NodeRow[]> = { OOP: [], IP: [] };
  for (const row of shuffle(rows)) byActor[row.actor].push(row);

  // Interleave OOP and IP so a session "cycles through the positions".
  const order: NodeRow[] = [];
  while (order.length < count && (byActor.OOP.length || byActor.IP.length)) {
    if (byActor.OOP.length) order.push(byActor.OOP.pop()!);
    if (order.length < count && byActor.IP.length) order.push(byActor.IP.pop()!);
  }

  const handStmt = db().prepare(
    "SELECT hand FROM strategies WHERE node_id = ? ORDER BY RANDOM() LIMIT 1",
  );
  const questions: Question[] = [];
  const seen = new Set<string>();

  for (const node of order) {
    let hand: string | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      const row = handStmt.get(node.id) as { hand?: string } | undefined;
      if (!row?.hand) break;
      if (!seen.has(`${node.id}:${row.hand}`)) {
        hand = row.hand;
        break;
      }
      hand = row.hand;
    }
    if (!hand) continue;
    seen.add(`${node.id}:${hand}`);

    const isOOP = node.actor === "OOP";
    questions.push({
      nodeId: node.id,
      spotId: node.spot_id,
      matchup: node.matchup,
      street: node.street as Question["street"],
      board: node.board.split(","),
      actor: node.actor,
      position: isOOP ? node.oop_position : node.ip_position,
      opponentPosition: isOOP ? node.ip_position : node.oop_position,
      pot: node.pot,
      effectiveStack: node.effective_stack,
      actions: JSON.parse(node.action_json) as string[],
      hand,
      holeCards: [hand.slice(0, 2), hand.slice(2, 4)],
    });
    if (questions.length >= count) break;
  }

  return questions;
}

export function getAnswer(nodeId: number, hand: string): Answer | null {
  const node = db()
    .prepare("SELECT action_json FROM nodes WHERE id = ?")
    .get(nodeId) as { action_json?: string } | undefined;
  if (!node?.action_json) return null;

  const actions = JSON.parse(node.action_json) as string[];
  const rows = db()
    .prepare(
      "SELECT action_index, freq FROM strategies WHERE node_id = ? AND hand = ?",
    )
    .all(nodeId, hand) as unknown as { action_index: number; freq: number }[];

  if (!rows.length) return null;

  const freqs = new Array(actions.length).fill(0) as number[];
  for (const row of rows) freqs[row.action_index] = row.freq;

  let bestIndex = 0;
  for (let i = 1; i < freqs.length; i++) {
    if (freqs[i] > freqs[bestIndex]) bestIndex = i;
  }

  return { nodeId, hand, actions, freqs, bestIndex, score: null };
}
