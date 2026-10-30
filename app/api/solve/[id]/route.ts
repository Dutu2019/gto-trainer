import { NextResponse } from "next/server";
import { getJob } from "@/lib/solve-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/solve/<jobId> -> status of one solve job.
//   The UI polls this until status is "done" or "error".
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: `unknown job '${id}'` }, { status: 404 });
  return NextResponse.json(job);
}
