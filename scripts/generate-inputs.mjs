// Generate TexasSolver input config files for every spot in spots.config.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spots, ranges, matchups, solverConfig, streetsFor } from "./spots.config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "data", "inputs");

export function buildInput(spot) {
  const range = ranges[spot.matchup];
  const lines = [];
  lines.push(`set_pot ${spot.pot}`);
  lines.push(`set_effective_stack ${spot.effectiveStack}`);
  lines.push(`set_board ${spot.board}`);
  lines.push(`set_range_oop ${range.oop}`);
  lines.push(`set_range_ip ${range.ip}`);

  for (const street of streetsFor(spot.street)) {
    for (const who of ["oop", "ip"]) {
      lines.push(`set_bet_sizes ${who},${street},bet,75`);
      lines.push(`set_bet_sizes ${who},${street},allin`);
    }
  }

  lines.push(`set_allin_threshold ${solverConfig.allinThreshold}`);
  lines.push("build_tree");
  lines.push(`set_thread_num ${solverConfig.threadNum}`);
  lines.push(`set_accuracy ${solverConfig.accuracy}`);
  lines.push(`set_max_iteration ${solverConfig.maxIteration}`);
  lines.push(`set_print_interval ${solverConfig.printInterval}`);
  lines.push(`set_use_isomorphism ${solverConfig.useIsomorphism}`);
  lines.push("start_solve");
  lines.push(`set_dump_rounds ${solverConfig.dumpRounds}`);
  lines.push("dump_result output_result.json");
  return lines.join("\n") + "\n";
}

export { ROOT, OUT_DIR, matchups, spots };

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("generate-inputs.mjs")) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const spot of spots) {
    const file = path.join(OUT_DIR, `${spot.id}.txt`);
    fs.writeFileSync(file, buildInput(spot), "utf8");
    console.log(`wrote ${path.relative(ROOT, file)}`);
  }
}
