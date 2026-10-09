import { Card } from "./Card";

export function Board({ cards }: { cards: string[] }) {
  const padded = [...cards];
  while (padded.length < 5) padded.push("");
  return (
    <div className="flex gap-2">
      {padded.map((code, i) => (
        <Card key={i} code={code} size="lg" />
      ))}
    </div>
  );
}

export function HandDisplay({ cards }: { cards: string[] }) {
  return (
    <div className="flex gap-2">
      {cards.map((code) => (
        <Card key={code} code={code} size="lg" />
      ))}
    </div>
  );
}
