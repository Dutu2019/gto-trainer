"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { PreflopLineSummary } from "@/lib/preflop";
import { Card } from "./Cards";

const SUITS = ["s", "h", "d", "c"] as const;
const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

type SolveJob = {
  id: string;
  stem: string;
  label: string;
  board: string;
  street: string;
  status: "running" | "done" | "error";
  log: string;
  spotId: number | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
};

/** "1m 05s" — how long the job has been running. */
function elapsed(job: SolveJob, now: number): string {
  const ms = (job.finishedAt ?? now) - job.startedAt;
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

const STREET_LABEL: Record<number, string> = { 3: "flop", 4: "turn", 5: "river" };

export default function SolveSpot() {
  const [lines, setLines] = useState<PreflopLineSummary[]>([]);
  const [lineId, setLineId] = useState<string | null>(null);
  const [openSeat, setOpenSeat] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<string[]>([]);
  const [job, setJob] = useState<SolveJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // 1) load the playable preflop lines
  useEffect(() => {
    fetch("/api/preflop/lines?playable=1")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        return j as { lines: PreflopLineSummary[] };
      })
      .then((j) => {
        setLines(j.lines);
        if (j.lines.length) setLineId(j.lines[0].id);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  // 2) poll the running job until it finishes
  useEffect(() => {
    if (!job || job.status !== "running") return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/solve/${job.id}`);
        const j = (await r.json()) as SolveJob;
        if (stop) return;
        setJob(j);
        if (j.status === "running") setTimeout(tick, 2000);
      } catch {
        if (!stop) setTimeout(tick, 3000);
      }
    };
    const t = setTimeout(tick, 1000);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [job]);

  // 3) tick while a job runs so the elapsed time stays live
  useEffect(() => {
    if (!job || job.status !== "running") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job]);

  const seats = useMemo(
    () => [...new Set(lines.map((l) => l.openSeat))].sort(),
    [lines],
  );
  const filtered = useMemo(
    () =>
      lines.filter(
        (l) =>
          (openSeat === "all" || l.openSeat === openSeat) &&
          (!query || l.label.toLowerCase().includes(query.toLowerCase())),
      ),
    [lines, openSeat, query],
  );
  const line = lines.find((l) => l.id === lineId) ?? null;

  const addCard = (card: string) => {
    if (cards.length >= 5 || cards.includes(card)) return;
    setCards([...cards, card]);
    setJob(null);
  };

  const solve = async (force = false) => {
    if (!line || cards.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setJob(null);
    try {
      const r = await fetch("/api/solve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineId: line.id, board: cards, force }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setJob(j.job as SolveJob);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const used = new Set(cards);

  return (
    <main className="solve">
      <header className="top">
        <h1>Solve a spot</h1>
        <Link className="link" href="/">
          Viewer →
        </Link>
      </header>

      {error && <div className="error">{error}</div>}

      <div className="panes">
        <section className="left">
          <h2>1 · Preflop action</h2>
          <div className="filters">
            <select value={openSeat} onChange={(e) => setOpenSeat(e.target.value)}>
              <option value="all">All openers</option>
              {seats.map((s) => (
                <option key={s} value={s}>
                  {s} opens
                </option>
              ))}
            </select>
            <input
              placeholder="Search action…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="linelist">
            {filtered.map((l) => (
              <button
                key={l.id}
                className={`line ${l.id === lineId ? "sel" : ""}`}
                onClick={() => {
                  setLineId(l.id);
                  setJob(null);
                }}
              >
                <span className="line-label">{l.label}</span>
                <span className="line-meta">
                  {l.oop} vs {l.ip} · pot {l.potBb}bb · stack {l.effStackBb}bb
                </span>
              </button>
            ))}
            {!filtered.length && <p className="hint">No lines match.</p>}
          </div>
        </section>

        <section className="right">
          <h2>
            2 · Board <small>{line ? `${line.oop} vs ${line.ip}` : ""}</small>
          </h2>

          <div className="boardrow">
            <div className="cards">
              {cards.map((c) => (
                <Card key={c} card={c} />
              ))}
              {cards.length < 3 && <span className="hint">pick 3 flop cards</span>}
              {cards.length === 3 && <span className="hint">flop set — add a turn or river, or solve</span>}
              {cards.length === 4 && <span className="hint">turn set — add a river, or solve</span>}
            </div>
          </div>

          <div className="cardgrid">
            {SUITS.map((suit) =>
              RANKS.map((rank) => {
                const card = `${rank}${suit}`;
                return (
                  <button
                    key={card}
                    className="pick"
                    disabled={used.has(card)}
                    onClick={() => addCard(card)}
                  >
                    <Card card={card} />
                  </button>
                );
              }),
            )}
          </div>

          <div className="actions">
            <button onClick={() => setCards(cards.slice(0, -1))} disabled={!cards.length}>
              Undo
            </button>
            <button onClick={() => setCards([])} disabled={!cards.length}>
              Clear
            </button>
            <button className="primary" onClick={() => solve(false)} disabled={!line || cards.length < 3 || busy}>
              {busy ? "Starting…" : `Solve ${STREET_LABEL[cards.length] ?? ""}`}
            </button>
          </div>

          <p className="hint">
            {cards.length === 3
              ? "A flop solve covers three streets and can take several minutes; it uses a single bet size per street so the tree fits in memory. You can keep using the app while it runs."
              : "Turn and river solves usually finish in seconds."}
          </p>

          {job && (
            <div className={`job ${job.status}`}>
              <div className="job-head">
                <strong>{job.label}</strong>
                <span>
                  {job.status === "running" ? `solving… ${elapsed(job, now)}` : job.status}
                </span>
              </div>
              {job.status === "running" && <div className="bar busy" />}
              {job.status === "done" && job.spotId != null && (
                <p className="job-done">
                  Solve ready — spot #{job.spotId}.{" "}
                  <a className="link" href={`/?spot=${job.spotId}`}>
                    Open in viewer →
                  </a>
                </p>
              )}
              {job.status === "error" && <p className="job-error">{job.error}</p>}
              {job.log && <pre className="job-log">{job.log}</pre>}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
