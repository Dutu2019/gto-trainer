import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { groupSpots, listSpots } from "@/lib/solve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/spots -> every solved spot in the database, plus the same spots
// grouped by preflop line and flop (what the viewer's picker shows).
export function GET() {
  const spots = listSpots(getDb());
  return NextResponse.json({ spots, groups: groupSpots(spots) });
}
