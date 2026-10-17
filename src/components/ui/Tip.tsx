"use client";

import { useEffect, useState } from "react";

interface TipState {
  main: string;
  hint?: string;
  kbd?: string;
  side: "top" | "bottom" | "left" | "right";
  tone: "lens" | "paper";
  x: number;
  y: number;
}

/**
 * Global tooltip layer. Any element with `data-tip` shows a tooltip on hover/focus;
 * `data-tip-hint` adds a muted second line, `data-tip-kbd` a key chip, `data-tip-side`
 * the placement and `data-tip-tone="paper"` (on an ancestor) the light variant.
 */
export function TipLayer() {
  const [tip, setTip] = useState<TipState | null>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let timer: number | undefined;

    const place = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const side = (el.dataset.tipSide as TipState["side"]) || "bottom";
      const tone = el.closest("[data-tip-tone=paper]") ? "paper" : "lens";
      let x = r.left + r.width / 2;
      let y = r.bottom + 8;
      if (side === "top") y = r.top - 8;
      if (side === "left") {
        x = r.left - 8;
        y = r.top + r.height / 2;
      }
      if (side === "right") {
        x = r.right + 8;
        y = r.top + r.height / 2;
      }
      setTip({ main: el.dataset.tip ?? "", hint: el.dataset.tipHint, kbd: el.dataset.tipKbd, side, tone, x, y });
    };

    const show = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]") as HTMLElement | null;
      if (!el || el === target) return;
      target = el;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => target && place(target), e.type === "focusin" ? 0 : 350);
    };
    const hide = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.("[data-tip]");
      if (el && el !== target) return;
      target = null;
      window.clearTimeout(timer);
      setTip(null);
    };
    document.addEventListener("pointerover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("pointerout", hide);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    return () => {
      document.removeEventListener("pointerover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("pointerout", hide);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
    };
  }, []);

  if (!tip || !tip.main) return null;
  const transform =
    tip.side === "top"
      ? "translate(-50%, -100%)"
      : tip.side === "left"
        ? "translate(-100%, -50%)"
        : tip.side === "right"
          ? "translate(0, -50%)"
          : "translate(-50%, 0)";
  return (
    <div className="tip-box" data-side={tip.side} aria-hidden="true" style={{ transform: `translate(${tip.x}px, ${tip.y}px)` }}>
      <div className={`tip ${tip.tone === "paper" ? "tip-paper" : ""}`} style={{ transform }}>
        <span className="tip-main">
          {tip.main}
          {tip.kbd ? <kbd className="tip-kbd">{tip.kbd}</kbd> : null}
        </span>
        {tip.hint ? <span className="tip-hint">{tip.hint}</span> : null}
      </div>
    </div>
  );
}
