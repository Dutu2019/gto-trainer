// Builds a TexasSolver console input file for a heads-up postflop spot.
//
// Tree size is the binding constraint here, not CPU. Every extra bet size or
// all-in option multiplies the node count, and a flop solve builds the whole
// three-street tree while a turn/river solve builds only the remainder.
// Measured on a 32 GB machine for a 97 bb stack / 5.5 bb pot spot:
//
//   flop start, one size per street, no all-in   ~6 GB   finishes
//   flop start, two sizes per street            >20 GB   solver dies (OOM)
//   flop start, two sizes + all-in everywhere   >15 GB   solver dies (OOM)
//
// A solver that runs out of memory stops printing iterations and never exits,
// which is what made flop solves look like they hung forever — so a flop solve
// gets a single bet size per street and an all-in only where the stack is
// shallow. Turn/river solves have fewer streets left, fit easily, and keep the
// richer sizing (33/75 % bets, 60 % raises, all-in).

import crypto from "node:crypto";

export type Street = "flop" | "turn" | "river";

/**
 * Filename stem for one solve: `<oop>_<ip>_<street>_<board>_<id>`.
 *
 * scripts/run-and-import.js reads the seats, street and board from this name,
 * and data/inputs/<stem>.txt, data/raw/<stem>.json and spots.source_file are
 * all keyed by it. The board alone does *not* identify a solve: the same seats
 * and flop can be reached from different preflop lines (different ranges, pot,
 * stack) and from different postflop nodes, so `key` is hashed onto the end.
 * Without it, importing the second tree deletes the first row with the same
 * source_file and the two solves overwrite each other.
 */
export function spotStem(
  oop: string,
  ip: string,
  street: Street,
  board: string,
  key: string,
): string {
  const id = crypto.createHash("sha1").update(key).digest("hex").slice(0, 8);
  return `${oop.toLowerCase()}_${ip.toLowerCase()}_${street}_${board}_${id}`;
}

export type SpotConfig = {
  /** Position labels, e.g. "BB" / "BTN". */
  oop: string;
  ip: string;
  /** 3–5 cards, e.g. ["Qs", "Jh", "4d"]. */
  board: string[];
  potBb: number;
  effStackBb: number;
  /** Solver range strings, e.g. "AA:1.0,AKs:0.648,...". */
  rangeOop: string;
  rangeIp: string;
  threadNum?: number;
};

export const CARD_RE = /^[2-9TJQKA][shdc]$/;

/** Streets still to be played for a board of 3, 4 or 5 cards. */
export function streetsFor(boardLength: number): Street[] {
  if (boardLength === 3) return ["flop", "turn", "river"];
  if (boardLength === 4) return ["turn", "river"];
  if (boardLength === 5) return ["river"];
  throw new Error(`board must have 3-5 cards, got ${boardLength}`);
}

export function streetFor(boardLength: number): Street {
  return ({ 3: "flop", 4: "turn", 5: "river" } as const)[boardLength] as Street;
}

export function rangeIsEmpty(range: string | undefined): boolean {
  return !range || range.trim().length === 0;
}

/**
 * An all-in only earns a branch while the shove is small relative to the pot;
 * an 18x-pot jam adds tree without teaching anything.
 */
const ALLIN_MAX_SPR = 6;

type BettingPlan = {
  bet: Record<Street, number[]>;
  raise: Record<Street, number[]>;
};

/** Betting tree for a solve that starts on `start`. */
function bettingPlan(start: Street): BettingPlan {
  if (start === "flop") {
    // One size per street: the only configuration that fits in RAM.
    return {
      bet: { flop: [33], turn: [75], river: [75] },
      raise: { flop: [60], turn: [60], river: [60] },
    };
  }
  const rich = [33, 75];
  return {
    bet: { flop: rich, turn: rich, river: rich },
    raise: { flop: [60], turn: [60], river: [60] },
  };
}

export function buildSolverInput(cfg: SpotConfig): string {
  const streets = streetsFor(cfg.board.length);
  const start = streetFor(cfg.board.length);
  const plan = bettingPlan(start);
  const spr = cfg.potBb > 0 ? cfg.effStackBb / cfg.potBb : Infinity;
  const lines: string[] = [
    `set_pot ${cfg.potBb}`,
    `set_effective_stack ${cfg.effStackBb}`,
    `set_board ${cfg.board.join(",")}`,
    `set_range_oop ${cfg.rangeOop}`,
    `set_range_ip ${cfg.rangeIp}`,
  ];

  for (const who of ["oop", "ip"]) {
    for (const street of streets) {
      const bets = plan.bet[street].filter((pct) => pct > 0 && pct < 100);
      if (bets.length) lines.push(`set_bet_sizes ${who},${street},bet,${bets.join(",")}`);
      const raises = plan.raise[street].filter((pct) => pct > 0 && pct < 100);
      if (raises.length) lines.push(`set_bet_sizes ${who},${street},raise,${raises.join(",")}`);
      // A flop solve only jams the river, and only when it is a real jam.
      const allin =
        start === "flop" ? street === "river" && spr <= ALLIN_MAX_SPR : true;
      if (allin) lines.push(`set_bet_sizes ${who},${street},allin`);
    }
  }

  lines.push(
    "set_allin_threshold 0.67",
    "build_tree",
    `set_thread_num ${cfg.threadNum ?? 18}`,
    "set_accuracy 0.5",
    // A flop solve is the slow case; cap it so the whole job stays bounded.
    `set_max_iteration ${start === "flop" ? 100 : 120}`,
    "set_print_interval 10",
    "set_use_isomorphism 1",
    "start_solve",
    "set_dump_rounds 1",
    "dump_result output_result.json",
  );
  return lines.join("\n") + "\n";
}
