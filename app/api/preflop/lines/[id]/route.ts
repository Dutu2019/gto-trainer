import { NextResponse } from "next/server";
import { readPreflopLine } from "@/lib/preflop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/preflop/lines/<id> -> one preflop line, both players' ranges included.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const line = readPreflopLine(id);
  if (!line) return NextResponse.json({ error: `unknown preflop line '${id}'` }, { status: 404 });
  return NextResponse.json(line);
}
