import { cardColor, cardRank, cardSuitSymbol } from "@/lib/cards";

type Size = "sm" | "md" | "lg";

const SIZES: Record<Size, string> = {
  sm: "w-8 h-11 text-sm",
  md: "w-11 h-15 text-base",
  lg: "w-14 h-20 text-xl",
};

export function Card({
  code,
  size = "md",
}: {
  code?: string;
  size?: Size;
}) {
  if (!code) {
    return (
      <div
        className={`${SIZES[size]} rounded-lg border border-dashed border-zinc-700 bg-zinc-900/60`}
      />
    );
  }

  const red = cardColor(code) === "red";
  return (
    <div
      className={`${SIZES[size]} flex flex-col items-center justify-center rounded-lg bg-white font-semibold leading-none shadow-md ${
        red ? "text-red-600" : "text-zinc-900"
      }`}
    >
      <span>{cardRank(code)}</span>
      <span className="mt-0.5">{cardSuitSymbol(code)}</span>
    </div>
  );
}
