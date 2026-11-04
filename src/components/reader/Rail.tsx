"use client";

import { useEffect, useState, type RefObject } from "react";
import type { Block } from "@/lib/content/types";
import { useT } from "@/i18n/client";

interface Props {
  blocks: Block[];
  rootRef: RefObject<HTMLElement | null>;
  /** 0..1 position in the text. */
  progress: number;
  marks: { blockId: string; color?: string }[];
}

/** Left minimap ("Map"): one bar per block, scaled to the text; click or drag to scroll. */
export function Rail({ blocks, rootRef, progress, marks }: Props) {
  const t = useT();
  const [rows, setRows] = useState<{ id: string; top: number; height: number; width: number }[]>([]);
  const [railH, setRailH] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const measure = () => {
      const els = Array.from(root.querySelectorAll<HTMLElement>(".blk"));
      if (!els.length) return;
      const total = root.scrollHeight;
      const h = Math.max(100, window.innerHeight - 60 - 64 - 28);
      setRailH(h);
      const scale = h / total;
      setRows(
        els.map((el) => {
          const len = el.textContent?.length ?? 0;
          return { id: el.dataset.block ?? "", top: el.offsetTop * scale, height: Math.max(1, el.offsetHeight * scale - 2), width: Math.min(18, 8 + Math.sqrt(len) / 2) };
        }),
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [rootRef, blocks]);

  const seek = (clientY: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: ratio * max, behavior: "auto" });
  };

  const markSet = new Map(marks.map((m) => [m.blockId, m.color]));
  return (
    <div
      role="slider"
      aria-label={t("rail.position")}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      tabIndex={0}
      onKeyDown={(e) => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const step = max * 0.05;
        const map: Record<string, number | undefined> = { ArrowDown: step, ArrowRight: step, PageDown: step * 4, ArrowUp: -step, ArrowLeft: -step, PageUp: -step * 4, Home: -max, End: max };
        const d = map[e.key];
        if (d === undefined) return;
        e.preventDefault();
        window.scrollTo({ top: Math.min(max, Math.max(0, window.scrollY + d)), behavior: "auto" });
      }}
      className="group relative h-full cursor-pointer touch-none select-none rounded-sm"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        seek(e.clientY, e.currentTarget);
      }}
      onPointerMove={(e) => e.buttons === 1 && seek(e.clientY, e.currentTarget)}
    >
      {rows.map((r) => (
        <span
          key={r.id}
          className="absolute left-[6px]"
          style={{
            top: r.top,
            height: r.height,
            width: r.width,
            background: markSet.has(r.id)
              ? `color-mix(in oklab, var(--mk-${markSet.get(r.id) ?? "yellow"}) 70%, transparent)`
              : "repeating-linear-gradient(to bottom, var(--ink-4) 0 1px, transparent 1px 3px)",
            opacity: 0.75,
          }}
        />
      ))}
      <span aria-hidden="true" className="absolute left-0 right-0 h-[2px] rounded-full bg-[var(--rubric)]" style={{ top: progress * railH }} />
      <span aria-hidden="true" className="absolute -left-[2px] right-0 rounded-[3px] bg-[var(--rubric-wash)] opacity-0 transition-opacity group-hover:opacity-100" style={{ top: 0, height: progress * railH }} />
    </div>
  );
}
