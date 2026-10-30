import { NextResponse } from "next/server";
import { buildContinuation, dealTarget } from "@/lib/continuation";
import { startContinuation } from "@/lib/solve-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/continuation?spotId=6&path=x-b2-c
//   -> { target: { street, potBb, effStackBb, board, cards: [{card, spotId, blocked}] } }
//   `path` is the action path of a chance node, i.e. the action that closed the
//   street. `cards[i].spotId` is set when that card already has a solve for
//   this line and flop, so the viewer can open it instead of solving again.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const spotId = Number(url.searchParams.get("spotId"));
  const path = url.searchParams.get("path") ?? "";
  if (!Number.isInteger(spotId) || spotId <= 0) {
    return NextResponse.json({ error: "spotId is required" }, { status: 400 });
  }
  const res = dealTarget(spotId, path);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ target: res.target });
}

// POST /api/continuation { spotId, path, card }
//   -> { job, cached } — solves the next street from the ranges that reach the
//   end-of-street node. `path` is again the chance node's action path.
export async function POST(req: Request) {
  let body: { spotId?: number; fromSpotId?: number; path?: string; card?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const spotId = Number(body.spotId ?? body.fromSpotId);
  if (!Number.isInteger(spotId) || spotId <= 0) {
    return NextResponse.json({ error: "spotId is required" }, { status: 400 });
  }
  if (!body.card) {
    return NextResponse.json({ error: "card is required" }, { status: 400 });
  }
  const path = body.path ?? "";

  // Validate before starting a job so a bad card reports a clean 400.
  const built = buildContinuation(spotId, path, body.card);
  if (!built.ok) return NextResponse.json({ error: built.error }, { status: built.status });

  const result = startContinuation({ fromSpotId: spotId, path, card: body.card, force: body.force });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ job: result.job, cached: result.cached });
}
