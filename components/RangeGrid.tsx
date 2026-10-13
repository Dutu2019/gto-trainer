import { stackedGradient } from "@/lib/colors";
import type { GridCell } from "@/lib/types";

type Props = {
  grid: GridCell[][];
  order: number[];
  colors: string[];
  selected: string | null;
  onSelect: (label: string) => void;
};

export default function RangeGrid({ grid, order, colors, selected, onSelect }: Props) {
  return (
    <div className="grid13">
      {grid.flat().map((c) => (
        <button
          key={c.label}
          className={`cell ${c.combos === 0 ? "empty" : ""} ${selected === c.label ? "sel" : ""}`}
          style={c.combos ? { background: stackedGradient(c.freqs, order, colors) } : undefined}
          title={`${c.label} (${c.combos} combos)`}
          onClick={() => onSelect(c.label)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
