"use client";

import { useEffect, useMemo, useState } from "react";
import { actionColors, displayOrder } from "@/lib/colors";
import type { NodeResponse, SpotInfo } from "@/lib/types";
import ActionSummary from "./ActionSummary";
import { Cards } from "./Cards";
import HandTiles from "./HandTiles";
import RangeGrid from "./RangeGrid";
import TrailBar from "./TrailBar";

export default function Viewer() {
  const [spots, setSpots] = useState<SpotInfo[]>([]);
  const [spotId, setSpotId] = useState<number | null>(null);
  const [path, setPath] = useState("");
  const [data, setData] = useState<NodeResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 1) list solved spots, open the first
  useEffect(() => {
    fetch("/api/spots")
      .then((r) => r.json())
      .then((j: { spots: SpotInfo[] }) => {
        setSpots(j.spots);
        if (j.spots.length) setSpotId(j.spots[0].spotId);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // 2) load the node for (spot, path); ignore stale responses
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

  const colors = useMemo(() => (data ? actionColors(data.node.actions) : []), [data]);
  const order = useMemo(() => (data ? displayOrder(data.node.actions) : []), [data]);
  const rows = useMemo(
    () => (data && selected ? data.hands.filter((h) => h.cls === selected).reverse() : []),
    [data, selected],
  );

  const spot = data?.spot ?? spots.find((s) => s.spotId === spotId);

  return (
    <main className="viewer">
      <header className="top">
        <h1>Solve viewer</h1>
        {spots.length > 0 && (
          <select
            value={spotId ?? ""}
            onChange={(e) => {
              setSpotId(Number(e.target.value));
              setPath("");
              setSelected(null);
            }}
          >
            {spots.map((s) => (
              <option key={s.spotId} value={s.spotId}>
                {s.posIp} vs {s.posOop} · {s.street} · {s.board}
              </option>
            ))}
          </select>
        )}
        {spot && (
          <div className="meta">
            <Cards text={spot.board} />
            <span>
              {spot.posIp} (IP) vs {spot.posOop} (OOP)
            </span>
            {spot.potBb != null && <span>pot {spot.potBb}</span>}
            {spot.effStackBb != null && <span>stack {spot.effStackBb}</span>}
          </div>
        )}
      </header>

      {error && <div className="error">{error}</div>}
      {!data && !error && <p className="hint">Loading…</p>}

      {data && (
        <>
          <TrailBar trail={data.trail} onGo={(p) => { setPath(p); }} />
          <div className="panes">
            <section className="left">
              <RangeGrid grid={data.grid} order={order} colors={colors} selected={selected} onSelect={setSelected} />
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
      )}
    </main>
  );
}
