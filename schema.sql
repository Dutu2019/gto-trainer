-- GTO solve database (SQLite; Postgres-compatible with BLOB -> BYTEA, AUTOINCREMENT -> GENERATED)
PRAGMA foreign_keys = ON;
 
-- Global dictionary of the 1326 hole-card combos. combo_id is stable and shared by every spot.
-- Hand naming matches the solver export: higher card first (rank, then suit c<d<h<s), e.g. 'Ts8s', 'TsTc'.
CREATE TABLE IF NOT EXISTS combos (
  combo_id INTEGER PRIMARY KEY,         -- 0..1325
  hand     TEXT NOT NULL UNIQUE,        -- 'AsKd'
  c1       TEXT NOT NULL,               -- 'As'
  c2       TEXT NOT NULL                -- 'Kd'
);
 
-- One row per solved spot (one JSON file)
CREATE TABLE IF NOT EXISTS spots (
  spot_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file    TEXT NOT NULL,
  game_type      TEXT,                  -- 'cash6max', ...
  street         TEXT NOT NULL,         -- street the solve starts on: 'flop'|'turn'|'river'
  board          TEXT NOT NULL,         -- 'QsJh4d8c3s'
  board_canon    TEXT,                  -- suit-isomorphic form, for dedup/search
  pos_oop        TEXT NOT NULL,         -- 'BB'
  pos_ip         TEXT NOT NULL,         -- 'BTN'
  root_player_raw INTEGER NOT NULL,     -- file's player id that acts first (= OOP). In the sample: 1
  pot_bb         REAL,                  -- NOT in the JSON; supply at import
  eff_stack_bb   REAL,                  -- NOT in the JSON; supply at import
  bet_unit       TEXT,                  -- units of 'BET 2'/'RAISE 8' amounts (confirm w/ solver docs)
  solver         TEXT, solver_version TEXT,
  exploitability REAL,                  -- NOT in the JSON
  imported_at    TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_file)
);
 
-- The hands each side can hold in this spot. Fixed for the whole tree, so stored ONCE here
-- instead of repeating 214/222 hand strings in every node. Array position = column index in strategy blobs.
CREATE TABLE IF NOT EXISTS spot_ranges (
  spot_id   INTEGER NOT NULL REFERENCES spots(spot_id) ON DELETE CASCADE,
  side      TEXT NOT NULL CHECK (side IN ('OOP','IP')),
  n_hands   INTEGER NOT NULL,
  combo_ids BLOB NOT NULL,              -- uint16 little-endian [n_hands], references combos
  PRIMARY KEY (spot_id, side)
);
 
-- Decision nodes only (tree structure, no numbers)
CREATE TABLE IF NOT EXISTS nodes (
  spot_id     INTEGER NOT NULL REFERENCES spots(spot_id) ON DELETE CASCADE,
  node_id     INTEGER NOT NULL,         -- DFS pre-order, root = 0
  parent_id   INTEGER,
  action_in   TEXT,                     -- compact action that led here: 'b5', 'r15'
  action_path TEXT NOT NULL,            -- '' for root, else 'x-b5-r15'
  depth       INTEGER NOT NULL,
  player      TEXT NOT NULL CHECK (player IN ('OOP','IP')),
  n_actions   INTEGER NOT NULL,
  PRIMARY KEY (spot_id, node_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_nodes_path   ON nodes(spot_id, action_path);
CREATE INDEX        IF NOT EXISTS ix_nodes_parent ON nodes(spot_id, parent_id);
 
-- Every action available at a node, in blob row order. child_node_id NULL = terminal
-- (fold, call, or check-back: the file has no node for these).
CREATE TABLE IF NOT EXISTS node_actions (
  spot_id       INTEGER NOT NULL,
  node_id       INTEGER NOT NULL,
  action_idx    INTEGER NOT NULL,       -- row index in the strategy blob
  action_raw    TEXT NOT NULL,          -- 'BET 5.000000' exactly as in the file
  kind          TEXT NOT NULL,          -- CHECK|BET|CALL|RAISE|FOLD
  amount        REAL,                   -- parsed number, NULL for CHECK/CALL/FOLD
  child_node_id INTEGER,
  PRIMARY KEY (spot_id, node_id, action_idx),
  FOREIGN KEY (spot_id, node_id) REFERENCES nodes(spot_id, node_id) ON DELETE CASCADE
);
 
-- Numeric payload: one blob per node, kept apart so tree browsing never touches it.
-- Layout: uint8 [n_actions][n_hands], action-major, then compressed.
-- Each hand's column sums to 255 (largest-remainder rounding), so freq = value/255.
CREATE TABLE IF NOT EXISTS node_strategy (
  spot_id  INTEGER NOT NULL,
  node_id  INTEGER NOT NULL,
  encoding TEXT NOT NULL DEFAULT 'u8_actionmajor_zlib',
  strategy BLOB NOT NULL,
  PRIMARY KEY (spot_id, node_id),
  FOREIGN KEY (spot_id, node_id) REFERENCES nodes(spot_id, node_id) ON DELETE CASCADE
);
 
-- Precomputed per-node aggregates for browsing / cross-spot queries (no blob decoding).
-- NOTE: the JSON has no range weights, so these are plain averages over the combos listed.
CREATE TABLE IF NOT EXISTS node_summary (
  spot_id INTEGER NOT NULL,
  node_id INTEGER NOT NULL,
  freq_unweighted TEXT NOT NULL,        -- JSON {"CHECK":0.41,"BET 5.000000":0.22,...}
  PRIMARY KEY (spot_id, node_id),
  FOREIGN KEY (spot_id, node_id) REFERENCES nodes(spot_id, node_id) ON DELETE CASCADE
);
