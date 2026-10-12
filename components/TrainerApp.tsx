"use client";

import { useState } from "react";
import { ActionBar } from "./ActionBar";
import { BettingOptionsPanel } from "./BettingOptionsPanel";
import { PokerTable, Seat } from "./PokerTable";
import { Progress } from "./Progress";
import { ResultPanel } from "./ResultPanel";
import { gradeAnswer, type GradeResult } from "@/lib/grading";
import { formatPct, MATCHUP_LABELS, STREET_LABELS } from "@/lib/format";
import type { AnsweredQuestion, Answer, Question, Street } from "@/lib/types";

const ALL_MATCHUPS = ["SB_BB", "BTN_BB"];
const ALL_STREETS: Street[] = ["turn", "river"];

type Phase = "setup" | "loading" | "training" | "review" | "error";

function errMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

export function TrainerApp() {
  const [phase, setPhase] = useState<Phase>("setup");
  const [matchups, setMatchups] = useState<string[]>(ALL_MATCHUPS);
  const [streets, setStreets] = useState<Street[]>(ALL_STREETS);
  const [count, setCount] = useState(20);
  const [error, setError] = useState("");

  const [questions, setQuestions] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const [history, setHistory] = useState<AnsweredQuestion[]>([]);

  const current = questions[index] ?? null;
  const grade: GradeResult | null =
    answer && chosenIndex != null
      ? gradeAnswer(answer.freqs, chosenIndex)
      : null;

  async function start() {
    if (!matchups.length || !streets.length) {
      setError("Pick at least one matchup and one street.");
      setPhase("error");
      return;
    }
    setPhase("loading");
    setError("");
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count, matchups, streets }),
      });
      const data = (await res.json()) as {
        questions?: Question[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to load session.");
      if (!data.questions?.length)
        throw new Error("No questions for those filters.");
      setQuestions(data.questions);
      setIndex(0);
      setAnswer(null);
      setChosenIndex(null);
      setHistory([]);
      setPhase("training");
    } catch (e) {
      setError(errMessage(e));
      setPhase("error");
    }
  }

  async function choose(i: number) {
    if (!current || answer) return;
    setChosenIndex(i);
    try {
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeId: current.nodeId,
          hand: current.hand,
          chosenIndex: i,
        }),
      });
      const data = (await res.json()) as Answer & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load answer.");
      setAnswer(data);
    } catch (e) {
      setError(errMessage(e));
      setPhase("error");
    }
  }

  function next() {
    if (!current || !answer || chosenIndex == null) return;
    setHistory((prev) => [...prev, { question: current, answer, chosenIndex }]);
    if (index + 1 < questions.length) {
      setIndex(index + 1);
      setAnswer(null);
      setChosenIndex(null);
    } else {
      setPhase("review");
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">
          GTO Trainer
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Postflop spots solved with TexasSolver. Pick the play, then compare it
          to the GTO strategy.
        </p>
      </header>

      {phase === "setup" && (
        <section className="space-y-6 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
          <div>
            <h2 className="mb-3 text-sm font-semibold text-zinc-200">
              Matchups
            </h2>
            <div className="flex flex-wrap gap-2">
              {ALL_MATCHUPS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMatchups((s) => toggle(s, m))}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                    matchups.includes(m)
                      ? "border-sky-400 bg-sky-500/15 text-sky-200"
                      : "border-zinc-700 bg-zinc-800 text-zinc-300"
                  }`}
                >
                  {MATCHUP_LABELS[m]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-zinc-200">
              Streets
            </h2>
            <div className="flex flex-wrap gap-2">
              {ALL_STREETS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStreets((prev) => toggle(prev, s))}
                  className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                    streets.includes(s)
                      ? "border-sky-400 bg-sky-500/15 text-sky-200"
                      : "border-zinc-700 bg-zinc-800 text-zinc-300"
                  }`}
                >
                  {STREET_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="count"
              className="mb-3 block text-sm font-semibold text-zinc-200"
            >
              Number of questions
            </label>
            <select
              id="count"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-40 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
            >
              {[10, 20, 30, 50].map((n) => (
                <option key={n} value={n}>
                  {n} questions
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={start}
            className="w-full rounded-lg bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-400"
          >
            Start training
          </button>
        </section>
      )}

      {phase === "loading" && (
        <p className="text-sm text-zinc-400">Building a session&hellip;</p>
      )}

      {phase === "error" && (
        <section className="space-y-4 rounded-2xl border border-red-900/60 bg-red-950/30 p-6">
          <p className="text-sm text-red-200">{error}</p>
          <button
            type="button"
            onClick={() => setPhase("setup")}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-200"
          >
            Back to setup
          </button>
        </section>
      )}

      {phase === "training" && current && (
        <section className="space-y-6">
          <Progress
            current={index}
            total={questions.length}
            history={history.map((h) => ({
              score: h.answer.freqs[h.chosenIndex] ?? 0,
            }))}
          />

          <div className="space-y-5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                <span className="rounded-full bg-zinc-800 px-3 py-1 font-medium text-zinc-300">
                  {STREET_LABELS[current.street]} &middot;{" "}
                  {MATCHUP_LABELS[current.matchup] ?? current.matchup}
                </span>
                <span>
                  You are {current.position} &middot;{" "}
                  {current.actor === "OOP" ? "out of position" : "in position"}
                </span>
              </div>
              {current.preflop && (
                <p className="rounded-lg bg-zinc-900/50 px-3 py-2 text-xs text-zinc-400">
                  <span className="font-semibold uppercase tracking-wide text-zinc-500">
                    Hand history:
                  </span>{" "}
                  {current.preflop}
                </p>
              )}
            </div>

            <Seat
              name="Opponent"
              position={current.opponentPosition}
              actor={current.actor === "OOP" ? "IP" : "OOP"}
              stack={current.effectiveStack}
              faceDown
            />

            <PokerTable
              board={current.board}
              pot={current.pot}
              effectiveStack={current.effectiveStack}
            />

            <Seat
              name="You"
              position={current.position}
              actor={current.actor}
              stack={current.effectiveStack}
              cards={current.holeCards}
            />

            <BettingOptionsPanel
              options={current.bettingOptions}
              actingPosition={current.position}
              street={current.street}
            />

            <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
              <p className="text-sm font-medium text-zinc-300">
                What do you do?
              </p>
              <ActionBar
                actions={current.actions}
                onChoose={choose}
                disabled={!!answer}
                chosenIndex={chosenIndex}
              />
            </div>

            {answer && grade && chosenIndex != null && (
              <ResultPanel
                answer={answer}
                chosenIndex={chosenIndex}
                grade={grade}
              />
            )}

            {answer && (
              <button
                type="button"
                onClick={next}
                className="w-full rounded-lg bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-900 transition-colors hover:bg-white"
              >
                {index + 1 < questions.length ? "Next question" : "See results"}
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => setPhase("setup")}
            className="text-xs text-zinc-500 underline-offset-2 hover:underline"
          >
            Quit session
          </button>
        </section>
      )}

      {phase === "review" && (
        <Review history={history} onRestart={() => setPhase("setup")} />
      )}
    </main>
  );
}

function Review({
  history,
  onRestart,
}: {
  history: AnsweredQuestion[];
  onRestart: () => void;
}) {
  const avg =
    history.length > 0
      ? history.reduce(
          (sum, h) => sum + (h.answer.freqs[h.chosenIndex] ?? 0),
          0,
        ) / history.length
      : 0;

  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6 text-center">
        <div className="text-xs uppercase tracking-wide text-zinc-500">
          Average score
        </div>
        <div className="mt-2 text-4xl font-bold text-zinc-50">
          {formatPct(avg)}
        </div>
        <div className="mt-1 text-sm text-zinc-400">
          {history.length} questions answered
        </div>
      </div>

      <div className="space-y-2">
        {history.map((entry, i) => {
          const score = entry.answer.freqs[entry.chosenIndex] ?? 0;
          const best = entry.answer.bestIndex;
          return (
            <div
              key={i}
              className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3 text-sm"
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-zinc-400">
                    {entry.question.hand}
                  </span>
                  <span className="text-zinc-500">
                    {STREET_LABELS[entry.question.street]} &middot;{" "}
                    {entry.question.position}
                  </span>
                </div>
                {entry.question.preflop && (
                  <span className="text-[11px] text-zinc-500">
                    {entry.question.preflop}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-zinc-400">
                  Yours:{" "}
                  {entry.answer.actions[entry.chosenIndex]?.split(" ")[0]}
                </span>
                <span className="text-emerald-300">
                  GTO: {entry.answer.actions[best]?.split(" ")[0]}
                </span>
                <span
                  className={`w-12 text-right font-semibold ${
                    score >= 0.5 ? "text-emerald-300" : "text-amber-300"
                  }`}
                >
                  {formatPct(score)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onRestart}
        className="w-full rounded-lg bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-sky-400"
      >
        New session
      </button>
    </section>
  );
}
