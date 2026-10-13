import type { ActionInfo } from "./types";

const FOLD = "#3d7ab8";
const PASSIVE = "#3f9d52"; // check / call
const LIGHT_RED = [239, 68, 68];
const DARK_RED = [127, 29, 29];

const mix = (t: number) => {
  const c = LIGHT_RED.map((v, i) => Math.round(v + (DARK_RED[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};

/** One color per action (indexed by action idx). Bigger bets/raises are darker red. */
export function actionColors(actions: ActionInfo[]): string[] {
  const aggressive = actions
    .filter((a) => a.kind === "BET" || a.kind === "RAISE")
    .sort((a, b) => (a.amount ?? 0) - (b.amount ?? 0));
  return actions.map((a) => {
    if (a.kind === "FOLD") return FOLD;
    if (a.kind === "CHECK" || a.kind === "CALL") return PASSIVE;
    const pos = aggressive.findIndex((x) => x.idx === a.idx);
    return mix(aggressive.length > 1 ? pos / (aggressive.length - 1) : 0);
  });
}

/** Display order like GTO Wizard: biggest bet first ... call/check ... fold last. Returns action idxs. */
export function displayOrder(actions: ActionInfo[]): number[] {
  const rank = (a: ActionInfo) => (a.kind === "BET" || a.kind === "RAISE" ? 0 : a.kind === "CALL" ? 1 : a.kind === "CHECK" ? 2 : 3);
  return [...actions]
    .sort((a, b) => rank(a) - rank(b) || (b.amount ?? 0) - (a.amount ?? 0))
    .map((a) => a.idx);
}

/** Hard-stop horizontal gradient: one colored segment per action, width = frequency. */
export function stackedGradient(freqs: number[], order: number[], colors: string[]): string {
  const segs = order.filter((i) => freqs[i] > 0).map((i) => ({ w: freqs[i] * 100, c: colors[i] }));
  if (!segs.length) return "transparent";
  let acc = 0;
  const stops = segs.map((s, k) => {
    const start = acc;
    acc += s.w;
    return `${s.c} ${start}% ${k === segs.length - 1 ? 100 : acc}%`;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

export const pct = (f: number, d = 1) => (f * 100).toFixed(d);
