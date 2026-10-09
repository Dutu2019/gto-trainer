import type { NextRequest } from "next/server";
import { dbExists, getAnswer } from "@/lib/db";

export async function POST(request: NextRequest) {
  if (!dbExists()) {
    return Response.json(
      { error: "Database not built. Run `npm run data:build` first." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    nodeId?: number;
    hand?: string;
    chosenIndex?: number;
  };

  if (body.nodeId == null || !body.hand) {
    return Response.json({ error: "nodeId and hand are required." }, { status: 400 });
  }

  const answer = getAnswer(Number(body.nodeId), String(body.hand));
  if (!answer) {
    return Response.json({ error: "Strategy not found." }, { status: 404 });
  }

  if (body.chosenIndex != null) {
    answer.score = answer.freqs[body.chosenIndex] ?? 0;
  }

  return Response.json(answer);
}
