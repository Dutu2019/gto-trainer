const SUIT: Record<string, { sym: string; bg: string }> = {
  s: { sym: "♠", bg: "#4b5563" },
  h: { sym: "♥", bg: "#b91c1c" },
  d: { sym: "♦", bg: "#1d4ed8" },
  c: { sym: "♣", bg: "#15803d" },
};

export function Card({ card }: { card: string }) {
  const s = SUIT[card[1]] ?? SUIT.s;
  return (
    <span className="card" style={{ background: s.bg }}>
      {card[0]}
      {s.sym}
    </span>
  );
}

/** 'QsJh4d8c3s' -> five chips */
export function Cards({ text }: { text: string }) {
  const cards = text.match(/[2-9TJQKA][shdc]/g) ?? [];
  return (
    <span className="cards">
      {cards.map((c, i) => (
        <Card key={i} card={c} />
      ))}
    </span>
  );
}
