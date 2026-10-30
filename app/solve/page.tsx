import { redirect } from "next/navigation";

// Preflop selection now lives in the viewer: the chart is walked from UTG in
// the same trail UI as the postflop streets, and the flop cards are asked for
// at the end of the line. Keep this route as a redirect for old bookmarks.
export default function Page() {
  redirect("/");
}
