import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { buildNodeResponse } from "@/lib/solve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/spots/1/node?path=x-b5-r15
//   path = compact action path from the root ('' = root node). Returns the node's actions, the
//   decision trail from the root, per-hand frequencies, the 13x13 range grid and action totals.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const spotId = Number(id);
  if (!Number.isInteger(spotId)) return NextResponse.json({ error: "invalid spot id" }, { status: 400 });

  const path = req.nextUrl.searchParams.get("path") ?? "";
  const data = buildNodeResponse(getDb(), spotId, path);
  if (!data) return NextResponse.json({ error: `no node at path '${path}' in spot ${spotId}` }, { status: 404 });
  return NextResponse.json(data);
}
