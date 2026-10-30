import { NextResponse } from "next/server";
import { readPreflopIndex } from "@/lib/preflop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/preflop/lines -> every 6-max preflop line in the chart index.
//   ?playable=1 keeps only the heads-up lines that reach a flop (the ones the
//   two-player solver can actually solve).
export function GET(req: Request) {
  const index = readPreflopIndex();
  if (!index)
    return NextResponse.json(
      { error: "preflop ranges not built. Run `npm run data:preflop` first." },
      { status: 503 },
    );

  const playable = new URL(req.url).searchParams.get("playable");
  const lines = playable ? index.lines.filter((l) => l.flopReachable) : index.lines;
  return NextResponse.json({ ...index, lines });
}
