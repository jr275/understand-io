import { topicInfo } from "@/lib/content/types";

const GLYPHS: Record<string, string> = {
  ai: "◈", programming: "⌘", infra: "⛭", data: "▤", security: "⛨", tech: "⌁", design: "✎", product: "⬡",
  startups: "➚", business: "▣", work: "⚒", economics: "⚖", money: "¤", science: "⚗", health: "✚", mind: "◎",
  climate: "☼", philosophy: "☉", history: "⌛", politics: "⚐", culture: "♪", writing: "✒", learning: "✦", living: "⌂", unsorted: "·",
};

/**
 * Topic glyph. The reference ships small painted icons per topic; this build draws a
 * typographic glyph on a tinted disc instead (documented deviation).
 */
export function TopicGlyph({ topic, size = 18, className = "" }: { topic: string; size?: number; className?: string }) {
  const t = topicInfo(topic);
  return (
    <span
      className={`glyph inline-grid shrink-0 place-items-center rounded-full ${className}`}
      aria-hidden="true"
      style={{ width: size, height: size, background: `color-mix(in oklab, ${t.color} 22%, #f4ecda)`, color: t.deep, fontSize: size * 0.58, lineHeight: 1, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${t.color} 35%, transparent)` }}
    >
      {GLYPHS[t.id] ?? "·"}
    </span>
  );
}

/** Decorative art for topic cards and covers: layered strokes in the topic colour. */
export function TopicArt({ topic, seed = 0 }: { topic: string; seed?: number }) {
  const t = topicInfo(topic);
  const rnd = (i: number) => {
    const x = Math.sin((seed + 1) * 9301 + i * 49297) * 233280;
    return x - Math.floor(x);
  };
  const shapes = Array.from({ length: 9 }, (_, i) => ({ x: 10 + rnd(i) * 80, y: 10 + rnd(i + 20) * 80, r: 6 + rnd(i + 40) * 22, o: 0.25 + rnd(i + 60) * 0.5 }));
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="100" height="100" fill={`color-mix(in oklab, ${t.color} 12%, #f6efdf)`} />
      {shapes.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="none" stroke={t.deep} strokeWidth={0.6} opacity={s.o} />
      ))}
      <path d={`M0 ${70 + rnd(99) * 20} Q 30 ${40 + rnd(98) * 30} 60 ${60 + rnd(97) * 20} T 100 ${50 + rnd(96) * 30}`} fill="none" stroke={t.color} strokeWidth={1.2} opacity={0.6} />
      <text x="50" y="58" textAnchor="middle" fontSize="30" fill={t.deep} opacity="0.55" fontFamily="var(--font-serif)">
        {GLYPHS[t.id]}
      </text>
    </svg>
  );
}
