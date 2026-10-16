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
  // Integer-only LCG so server and client agree bit for bit (Math.sin differs across engines).
  const rnd = (i: number) => {
    let x = (seed * 7919 + i * 104729 + 12345) >>> 0;
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return (x % 10000) / 10000;
  };
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  const shapes = Array.from({ length: 9 }, (_, i) => ({ x: r3(10 + rnd(i) * 80), y: r3(10 + rnd(i + 20) * 80), r: r3(6 + rnd(i + 40) * 22), o: r3(0.25 + rnd(i + 60) * 0.5) }));
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="100" height="100" fill={`color-mix(in oklab, ${t.color} 12%, #f6efdf)`} />
      {shapes.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="none" stroke={t.deep} strokeWidth={0.6} opacity={s.o} />
      ))}
      <path d={`M0 ${r3(70 + rnd(99) * 20)} Q 30 ${r3(40 + rnd(98) * 30)} 60 ${r3(60 + rnd(97) * 20)} T 100 ${r3(50 + rnd(96) * 30)}`} fill="none" stroke={t.color} strokeWidth={1.2} opacity={0.6} />
      <text x="50" y="58" textAnchor="middle" fontSize="30" fill={t.deep} opacity="0.55" fontFamily="var(--font-serif)">
        {GLYPHS[t.id]}
      </text>
    </svg>
  );
}
