import Database from "better-sqlite3";
import path from "node:path";

const DB_PATH = process.env.GTO_DB_PATH ?? path.join(process.cwd(), "data", "gto.db");

// reuse one connection across hot reloads in dev
const g = globalThis as unknown as { __gtoDb?: Database.Database };

export function getDb(): Database.Database {
  if (!g.__gtoDb) g.__gtoDb = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  return g.__gtoDb;
}
