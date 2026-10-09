import type { NextRequest } from "next/server";
import { dbExists, getSessionQuestions } from "@/lib/db";
import type { Actor, SessionFilters, Street } from "@/lib/types";

export async function POST(request: NextRequest) {
  if (!dbExists()) {
    return Response.json(
      { error: "Database not built. Run `npm run data:build` first." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as Partial<SessionFilters>;
  const filters: SessionFilters = {
    count: Number(body.count) || 20,
    matchups: Array.isArray(body.matchups) ? body.matchups : undefined,
    streets: Array.isArray(body.streets) ? (body.streets as Street[]) : undefined,
    actors: Array.isArray(body.actors) ? (body.actors as Actor[]) : undefined,
  };

  try {
    const questions = getSessionQuestions(filters);
    return Response.json({ questions });
  } catch (error) {
    console.error("session error", error);
    return Response.json({ error: "Failed to build session." }, { status: 500 });
  }
}
