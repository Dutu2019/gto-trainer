import { NextResponse, type NextRequest } from "next/server";
import { listJobs, startSolve } from "@/lib/solve-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/solve -> recently started solve jobs (newest first)
export function GET() {
  return NextResponse.json({ jobs: listJobs() });
}

// POST /api/solve  body: { lineId, board, force? }
//   Writes a TexasSolver input for the chosen preflop line + board and runs
//   scripts/run-and-import.js on it. Returns the job to poll.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { lineId?: string; board?: string | string[]; force?: boolean }
    | null;
  if (!body?.lineId || !body.board)
    return NextResponse.json({ error: "lineId and board are required" }, { status: 400 });

  const result = startSolve({
    lineId: String(body.lineId),
    board: body.board,
    force: Boolean(body.force),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ job: result.job, cached: result.cached }, { status: 202 });
}
