import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listAncestors } from "@/lib/solve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/spots/12/ancestors
//   -> { segments: [{ spotId, street, board, lineId, trail, dealtCard }, ...] }
//   The continuation chain, oldest first: for each ancestor, its trail up to the
//   node where the next card was dealt, plus that card. The viewer prepends these
//   to the current spot's trail so dealing a card extends the tree instead of
//   replacing it.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const spotId = Number(id);
  if (!Number.isInteger(spotId)) return NextResponse.json({ error: "invalid spot id" }, { status: 400 });
  return NextResponse.json({ segments: listAncestors(getDb(), spotId) });
}
