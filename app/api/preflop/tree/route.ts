import { NextResponse, type NextRequest } from "next/server";
import { preflopNode, preflopNodeForLine } from "@/lib/preflop-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/preflop/tree?path=UTG/2.5bb/MP/Fold
//   One preflop decision node: who acts, the chart's branches from here, the
//   trail from UTG, and — when the line ends — the resulting pot/stack and
//   whether a flop can be solved.
//
// GET /api/preflop/tree?line=<lineId>
//   The terminal node of a chart line, i.e. its full decision trail. Used to
//   prepend the preflop history to a solved spot's trail.
export function GET(req: NextRequest) {
  const url = new URL(req.url);
  const lineId = url.searchParams.get("line");
  const node = lineId ? preflopNodeForLine(lineId) : preflopNode(url.searchParams.get("path") ?? "");
  if (!node) {
    return NextResponse.json(
      { error: lineId ? `unknown preflop line '${lineId}'` : "no preflop node at that path" },
      { status: 404 },
    );
  }
  return NextResponse.json(node);
}
