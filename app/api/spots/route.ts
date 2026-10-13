import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listSpots } from "@/lib/solve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/spots -> every solved spot in the database
export function GET() {
  return NextResponse.json({ spots: listSpots(getDb()) });
}
