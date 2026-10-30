"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { actionColors, displayOrder } from "@/lib/colors";
import type {
  ChainSegment,
  NodeResponse,
  PreflopNode,
  SpotGroup,
  SpotInfo,
  TrailEntry,
  TrailStep,
} from "@/lib/types";
import ActionSummary from "./ActionSummary";
import { Card, Cards } from "./Cards";
import HandTiles from "./HandTiles";
import RangeGrid from "./RangeGrid";
import TrailBar from "./TrailBar";

const SUITS = ["s", "h", "d", "c"] as const;
const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"] as const;

/** Tag a trail path with where it comes from: the preflop chart or an ancestor spot. */
const PRE = "pre|";
const seg = (spotId: number) => `s${spotId}|`;

type CardOption = { card: string; spotId: number | null; blocked: boolean };
type DealTarget = {
  street: string;
  potBb: number;
  effStackBb: number;
  board: string;
  cards: CardOption[];
};
/** The chance node we are dealing a card at. */
type Deal = { fromSpotId: number; path: string; board: string };

/** Prefix every action path in a step (and its children) so clicks can be routed. */
function tag(step: TrailStep, prefix: string): TrailStep {
  return {
    ...step,
    path: prefix + step.path,
    actions: step.actions.map((a) => ({
      ...a,
      childPath: a.childPath === null ? null : prefix + a.childPath,
    })),
  };
}

export default function Viewer() {
  const [spots, setSpots] = useState<SpotInfo[]>([]);
  const [groups, setGroups] = useState<SpotGroup[]>([]);
  const [spotId, setSpotId] = useState<number | null>(null);
  const [path, setPath] = useState("");
  const [data, setData] = useState<NodeResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // dealing the next card at the end of a postflop street
  const [deal, setDeal] = useState<Deal | null>(null);
  const [target, setTarget] = useState<DealTarget | null>(null);
  const [dealMsg, setDealMsg] = useState<string | null>(null);
  const [dealing, setDealing] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // the preflop chart, walked from UTG until a line reaches the flop
  const [preflop, setPreflop] = useState(true);
  const [pfPath, setPfPath] = useState("");
  const [pfNode, setPfNode] = useState<PreflopNode | null>(null);
  const [pfError, setPfError] = useState<string | null>(null);
  const [flopCards, setFlopCards] = useState<string[]>([]);
  const [flopMsg, setFlopMsg] = useState<string | null>(null);
  const [solvingFlop, setSolvingFlop] = useState(false);

  // preflop history of the open spot (same TrailBar style, above the postflop steps)
  const [pfHist, setPfHist] = useState<{ lineId: string; steps: TrailStep[] } | null>(null);
  // ancestor spots of the open spot (flop -> turn -> river chain)
  const [chain, setChain] = useState<{ spotId: number; segments: ChainSegment[] } | null>(null);

  const booted = useRef(false);

  // 1) list solved spots (grouped by preflop line + flop); ?spot= opens one
  useEffect(() => {
    fetch("/api/spots")
      .then((r) => r.json())
      .then((j: { spots: SpotInfo[]; groups?: SpotGroup[] }) => {
        setSpots(j.spots);
        setGroups(j.groups ?? []);
        if (!booted.current) {
          booted.current = true;
          const wanted = Number(new URLSearchParams(window.location.search).get("spot"));
          if (Number.isInteger(wanted) && j.spots.some((s) => s.spotId === wanted)) {
            setPreflop(false);
            setSpotId(wanted);
          }
        }
      })
      .catch((e) => setError(String(e)));
  }, [reload]);

  // 2) the preflop chart node (UTG at the root)
  useEffect(() => {
    if (!preflop) return;
    let stale = false;
    fetch(`/api/preflop/tree?path=${encodeURIComponent(pfPath)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        return j as PreflopNode;
      })
      .then((j) => {
        if (stale) return;
        setPfNode(j);
        setPfError(null);
      })
      .catch((e) => !stale && setPfError(String(e.message ?? e)));
    return () => {
      stale = true;
    };
  }, [preflop, pfPath, reload]);

  // 3) load the node for (spot, path); ignore stale responses
  useEffect(() => {
    if (spotId === null) return;
    let stale = false;
    fetch(`/api/spots/${spotId}/node?path=${encodeURIComponent(path)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        return j as NodeResponse;
      })
      .then((j) => {
        if (stale) return;
        setData(j);
        setError(null);
      })
      .catch((e) => !stale && setError(String(e.message ?? e)));
    return () => {
      stale = true;
    };
  }, [spotId, path]);

  // 4) ancestors: the earlier streets this tree was dealt from
  useEffect(() => {
    if (spotId === null) return;
    let stale = false;
    fetch(`/api/spots/${spotId}/ancestors`)
      .then(async (r) => (r.ok ? ((await r.json()) as { segments: ChainSegment[] }) : { segments: [] }))
      .then((j) => {
        if (!stale) setChain({ spotId, segments: j.segments ?? [] });
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [spotId, reload]);

  // 5) preflop history of the open spot, so the trail reads preflop -> flop -> ...
  const segments = useMemo(
    () => (chain?.spotId === spotId ? chain.segments : []),
    [chain, spotId],
  );
  const lineId = data?.spot.lineId ?? segments[0]?.lineId ?? null;
  useEffect(() => {
    if (!lineId) return;
    let stale = false;
    fetch(`/api/preflop/tree?line=${encodeURIComponent(lineId)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as PreflopNode) : null))
      .then((j) => {
        if (!stale && j) setPfHist({ lineId, steps: j.trail });
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [lineId, reload]);

  // 6) resolve the card picker for the deal in progress
  useEffect(() => {
    if (!deal) return;
    let stale = false;
    fetch(`/api/continuation?spotId=${deal.fromSpotId}&path=${encodeURIComponent(deal.path)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        return j as { target: DealTarget };
      })
      .then((j) => !stale && setTarget(j.target))
      .catch((e) => !stale && setDealMsg(String(e.message ?? e)));
    return () => {
      stale = true;
    };
  }, [deal, reload]);

  const colors = useMemo(() => (data ? actionColors(data.node.actions) : []), [data]);
  const order = useMemo(() => (data ? displayOrder(data.node.actions) : []), [data]);
  const rows = useMemo(
    () => (data && selected ? data.hands.filter((h) => h.cls === selected).reverse() : []),
    [data, selected],
  );

  const spot = data?.spot ?? spots.find((s) => s.spotId === spotId);

  const openSpot = useCallback((id: number) => {
    setSpotId(id);
    setPath("");
    setSelected(null);
    setError(null);
    window.history.replaceState(null, "", `/?spot=${id}`);
  }, []);

  /** Leave the spot and start again at UTG. */
  const newSpot = useCallback(() => {
    setPreflop(true);
    setPfPath("");
    setFlopCards([]);
    setFlopMsg(null);
    setSpotId(null);
    setData(null);
    setDeal(null);
    setTarget(null);
    setDealMsg(null);
    setPath("");
    setSelected(null);
    setError(null);
    window.history.replaceState(null, "", "/");
  }, []);

  /** Poll a solve job until it imports a spot, reporting the last log line. */
  const waitForSpot = useCallback(
    async (jobId: string, onProgress?: (line: string) => void): Promise<number> => {
      for (let i = 0; i < 1600; i++) {
        const r = await fetch(`/api/solve/${jobId}`);
        if (!r.ok) throw new Error(`lost track of the solve job (${r.status})`);
        const j = (await r.json()) as {
          status: string;
          spotId: number | null;
          error: string | null;
          log?: string | null;
        };
        if (j.status === "done" && j.spotId != null) return j.spotId;
        if (j.status === "error") throw new Error(j.error ?? "solve failed");
        if (j.log && onProgress) {
          const lines = j.log.trim().split("\n");
          onProgress(lines[lines.length - 1] ?? "");
        }
        await new Promise((res) => setTimeout(res, 1500));
      }
      throw new Error("solve did not finish — check the data/raw log for the job");
    },
    [],
  );

  /** Deal `card` at the end of the street: open it if solved, otherwise solve it. */
  const dealCard = useCallback(
    async (card: string, solvedSpotId: number | null) => {
      if (!deal || dealing) return;
      if (solvedSpotId != null) {
        openSpot(solvedSpotId);
        return;
      }
      const street = target?.street ?? "next street";
      setDealing(card);
      setDealMsg(`solving the ${street} with ${card}…`);
      try {
        const r = await fetch("/api/continuation", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spotId: deal.fromSpotId, path: deal.path, card }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        const spotId = await waitForSpot(j.job.id as string, (line) =>
          setDealMsg(`solving ${street} ${card}… ${line}`),
        );
        openSpot(spotId);
        setReload((n) => n + 1);
        setDealMsg(`solved ${card} — pick another card to compare`);
      } catch (e) {
        setDealMsg(String((e as Error).message ?? e));
      } finally {
        setDealing(null);
      }
    },
    [deal, dealing, openSpot, target?.street, waitForSpot],
  );

  /** Three flop cards were picked: solve that flop for the chosen preflop line. */
  const solveFlop = useCallback(async () => {
    const leaf = pfNode?.leaf;
    if (!leaf || flopCards.length !== 3 || solvingFlop) return;
    setSolvingFlop(true);
    setFlopMsg(`solving ${flopCards.join("")}…`);
    try {
      const r = await fetch("/api/solve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lineId: leaf.lineId, board: flopCards.join("") }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      const id = await waitForSpot(j.job.id as string, (line) =>
        setFlopMsg(`solving ${flopCards.join("")}… ${line}`),
      );
      setPreflop(false);
      openSpot(id);
      setFlopCards([]);
      setFlopMsg(null);
      setReload((n) => n + 1);
    } catch (e) {
      setFlopMsg(String((e as Error).message ?? e));
    } finally {
      setSolvingFlop(false);
    }
  }, [flopCards, openSpot, pfNode?.leaf, solvingFlop, waitForSpot]);

  const toggleFlopCard = (card: string) => {
    setFlopMsg(null);
    setFlopCards((cur) => {
      if (cur.includes(card)) return cur.filter((c) => c !== card);
      if (cur.length >= 3) return cur;
      return [...cur, card];
    });
  };

  /**
   * The whole hand so far: preflop decisions, the flop, then each earlier
   * street (its decisions + the card dealt at its end), then the open spot.
   */
  const entries = useMemo<TrailEntry[]>(() => {
    if (!data) return [];
    const out: TrailEntry[] = [];
    if (lineId && pfHist?.lineId === lineId)
      for (const step of pfHist.steps) out.push(tag(step, PRE));

    const flop = (data.spot.board.match(/[2-9TJQKA][shdc]/gi) ?? []).slice(0, 3);
    out.push({ path: "cards|flop", cards: flop, label: "flop" });

    for (const chainSeg of segments) {
      for (const step of chainSeg.trail) out.push(tag(step, seg(chainSeg.spotId)));
      if (chainSeg.dealtCard)
        out.push({
          path: `cards|${chainSeg.spotId}|${chainSeg.dealtCard}`,
          cards: [chainSeg.dealtCard],
          label: chainSeg.board.length === 6 ? "turn" : "river",
        });
    }

    for (const step of data.trail) out.push(step);
    return out;
  }, [data, lineId, pfHist, segments]);

  const go = (p: string) => {
    if (p.startsWith(PRE)) {
      setPreflop(true);
      setPfPath(p.slice(PRE.length));
      setFlopCards([]);
      setFlopMsg(null);
      setDeal(null);
      setTarget(null);
      setDealMsg(null);
      setSpotId(null);
      setData(null);
      setPath("");
      setSelected(null);
      window.history.replaceState(null, "", "/");
      return;
    }
    const m = /^s(\d+)\|(.*)$/.exec(p);
    if (m) {
      const id = Number(m[1]);
      setDeal(null);
      setTarget(null);
      setDealMsg(null);
      setSpotId(id);
      setPath(m[2]);
      setSelected(null);
      setError(null);
      window.history.replaceState(null, "", `/?spot=${id}`);
      return;
    }
    setPath(p);
  };

  const leaf = preflop ? pfNode?.leaf ?? null : null;

  return (
    <main className="viewer">
      <header className="top">
        <h1>Solve viewer</h1>
        <button className="link" onClick={newSpot} title="Start again at UTG">
          New spot
        </button>
        {spots.length > 0 && (
          <select
            value={preflop ? "" : spotId ?? ""}
            onChange={(e) => {
              setDeal(null);
              setTarget(null);
              setDealMsg(null);
              setPreflop(false);
              setFlopMsg(null);
              openSpot(Number(e.target.value));
            }}
            title="Solved spots, grouped by preflop line and flop"
          >
            {preflop && (
              <option value="" disabled>
                solved spots…
              </option>
            )}
            {groups.map((g) => (
              <optgroup key={g.key} label={`${g.label} · flop ${g.flop}`}>
                {g.spots.map((s) => (
                  <option key={s.spotId} value={s.spotId}>
                    {s.street} · {s.board}
                    {s.potBb != null ? ` · ${s.potBb}bb pot` : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}

        {preflop ? (
          <div className="meta">
            {leaf ? (
              <>
                <span>{leaf.label}</span>
                <span>pot {leaf.potBb}</span>
                <span>stack {leaf.effStackBb}</span>
              </>
            ) : (
              <span>{pfNode?.seat ? `${pfNode.seat} to act · preflop` : "preflop"}</span>
            )}
          </div>
        ) : (
          spot && (
            <div className="meta">
              <Cards text={spot.board} />
              <span>
                {spot.posIp} (IP) vs {spot.posOop} (OOP)
              </span>
              {spot.potBb != null && <span>pot {spot.potBb}</span>}
              {spot.effStackBb != null && <span>stack {spot.effStackBb}</span>}
              {spot.lineLabel && <span className="dim">{spot.lineLabel}</span>}
            </div>
          )
        )}
      </header>

      {error && <div className="error">{error}</div>}
      {pfError && preflop && <div className="error">{pfError}</div>}

      {preflop ? (
        !pfNode ? (
          <p className="hint">Loading the preflop chart…</p>
        ) : (
          <>
            <TrailBar entries={pfNode.trail} onGo={setPfPath} />

            {leaf &&
              (leaf.solvable ? (
                <div className="deal">
                  <div className="deal-head">
                    <strong>Deal the flop · {leaf.label}</strong>
                    <span>
                      {leaf.potBb}bb pot · {leaf.effStackBb}bb behind
                      {leaf.oop && leaf.ip ? ` · ${leaf.oop} (OOP) vs ${leaf.ip} (IP)` : ""}
                    </span>
                  </div>
                  <p className="hint">
                    Pick three cards — that flop starts its own tree for this line. Re-pick to solve a
                    different flop.
                  </p>
                  <div className="boardrow">
                    <div className="cards">
                      {flopCards.map((c) => (
                        <Card key={c} card={c} />
                      ))}
                      {Array.from({ length: 3 - flopCards.length }).map((_, i) => (
                        <span key={i} className="hint">
                          pick a card
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="cardgrid">
                    {SUITS.map((suit) =>
                      RANKS.map((rank) => {
                        const card = `${rank}${suit}`;
                        const picked = flopCards.includes(card);
                        return (
                          <button
                            key={card}
                            className={`pick ${picked ? "sel" : ""}`}
                            disabled={solvingFlop || (!picked && flopCards.length >= 3)}
                            onClick={() => toggleFlopCard(card)}
                          >
                            <Card card={card} />
                          </button>
                        );
                      }),
                    )}
                  </div>
                  <div className="actions">
                    <button onClick={() => setFlopCards([])} disabled={solvingFlop || !flopCards.length}>
                      Clear
                    </button>
                    <button
                      className="primary"
                      onClick={solveFlop}
                      disabled={flopCards.length !== 3 || solvingFlop}
                    >
                      {solvingFlop ? "Starting…" : `Solve ${flopCards.join("") || "flop"}`}
                    </button>
                  </div>
                  {flopMsg && <p className="hint">{flopMsg}</p>}
                </div>
              ) : (
                <div className="deal">
                  <div className="deal-head">
                    <strong>{leaf.label}</strong>
                  </div>
                  <p className="hint">
                    {leaf.reason} Pick another branch, or start over with “New spot”.
                  </p>
                </div>
              ))}

            {!leaf && !pfNode.seat && pfNode.options.length === 0 && (
              <p className="hint">Everyone folded — the hand ends before the flop.</p>
            )}
          </>
        )
      ) : !data && !error ? (
        <p className="hint">Loading…</p>
      ) : (
        data && (
          <>
            <TrailBar
              entries={entries}
              onGo={go}
              onDeal={(p) => {
                if (p.startsWith(PRE)) return;
                // A "+card" action may belong to an ancestor spot (prefix `s<id>|`).
                const m = /^s(\d+)\|(.*)$/.exec(p);
                const fromSpotId = m ? Number(m[1]) : data.spot.spotId;
                const dealPath = m ? m[2] : p;
                const board = m
                  ? segments.find((s) => s.spotId === fromSpotId)?.board ?? data.spot.board
                  : data.spot.board;
                setDealMsg(null);
                setTarget(null);
                setDeal({ fromSpotId, path: dealPath, board });
              }}
            />

            {deal && (
              <div className="deal">
                <div className="deal-head">
                  <strong>
                    Deal the {target?.street ?? "next"} card · {deal.board}
                  </strong>
                  <span>
                    {target ? `${target.potBb}bb pot · ${target.effStackBb}bb behind` : ""}
                  </span>
                  <button
                    onClick={() => {
                      setDeal(null);
                      setTarget(null);
                      setDealMsg(null);
                    }}
                  >
                    Close
                  </button>
                </div>
                <p className="hint">
                  The card starts a new tree for the ranges that reach this point. Cards with ✓ are
                  already solved — click one to switch, or pick another card to solve it instead.
                </p>
                <div className="cardgrid">
                  {SUITS.map((suit) =>
                    RANKS.map((rank) => {
                      const card = `${rank}${suit}`;
                      const opt = target?.cards.find((c) => c.card === card);
                      const solved = opt?.spotId != null;
                      return (
                        <button
                          key={card}
                          className={`pick ${solved ? "solved" : ""} ${dealing === card ? "sel" : ""}`}
                          disabled={!target || opt?.blocked || dealing != null}
                          title={solved ? "Solved — open it" : `Solve this ${target?.street ?? "next street"}`}
                          onClick={() => dealCard(card, opt?.spotId ?? null)}
                        >
                          <Card card={card} />
                        </button>
                      );
                    }),
                  )}
                </div>
                {dealMsg && <p className="hint">{dealMsg}</p>}
              </div>
            )}

            <div className="panes">
              <section className="left">
                <RangeGrid
                  grid={data.grid}
                  order={order}
                  colors={colors}
                  selected={selected}
                  onSelect={setSelected}
                />
              </section>
              <section className="right">
                <h2>
                  {data.node.position} to act <small>{data.nHands} combos</small>
                </h2>
                <ActionSummary data={data} order={order} colors={colors} />
                <h3>{selected ? `${selected} combos` : "Hands"}</h3>
                {selected ? (
                  <HandTiles rows={rows} actions={data.node.actions} order={order} colors={colors} />
                ) : (
                  <p className="hint">Click a cell in the grid to see its combos.</p>
                )}
              </section>
            </div>
          </>
        )
      )}
    </main>
  );
}
