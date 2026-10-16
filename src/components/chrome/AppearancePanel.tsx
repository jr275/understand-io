"use client";

import { useState } from "react";
import { AlignJustify, AlignLeft, Focus, Headphones, Map, Minus, Paintbrush, Pilcrow, Plus } from "lucide-react";
import { Segmented } from "@/components/ui/Segmented";
import { SwitchButton, Toggle } from "@/components/ui/Switch";
import { useSettings, type Face, type Pen, type Theme } from "@/lib/store/settings";

const THEMES: { id: Theme; label: string; bg: string; fg: string; dark?: boolean; tip?: string }[] = [
  { id: "auto", label: "Auto", bg: "#f6f3ec", fg: "#1d1b18", tip: "Follows your system" },
  { id: "paper", label: "Paper", bg: "#f6f3ec", fg: "#1d1b18" },
  { id: "sepia", label: "Sepia", bg: "#f1e6cf", fg: "#33281b" },
  { id: "snow", label: "Snow", bg: "#ffffff", fg: "#141518" },
  { id: "night", label: "Night", bg: "#151412", fg: "#e9e3d6", dark: true },
  { id: "ink", label: "Ink", bg: "#0f1319", fg: "#e3e8f0", dark: true },
];
const PENS: { id: Pen; label: string; l: string; d: string }[] = [
  { id: "vermilion", label: "Vermilion", l: "#c1401b", d: "#ef7a50" },
  { id: "cobalt", label: "Cobalt", l: "#2c58c9", d: "#86a8ff" },
  { id: "moss", label: "Moss", l: "#3b7a3d", d: "#8fc68c" },
  { id: "graphite", label: "Graphite", l: "#4b4a47", d: "#cfc9bd" },
];
const MARKERS = [
  { id: "yellow", label: "Yellow", c: "#f2c438" },
  { id: "green", label: "Green", c: "#7cc66f" },
  { id: "blue", label: "Blue", c: "#6aa8f0" },
  { id: "pink", label: "Pink", c: "#f084ac" },
] as const;
const FACES: { id: Face; label: string; font: string }[] = [
  { id: "serif", label: "Serif", font: "var(--font-serif)" },
  { id: "book", label: "Book", font: "var(--font-book)" },
  { id: "sans", label: "Sans", font: "var(--font-sans)" },
  { id: "legible", label: "Legible", font: "var(--font-legible)" },
];

export function AppearancePanel({ reader = false }: { reader?: boolean }) {
  const [tab, setTab] = useState<"look" | "text" | "answers">("look");
  const [s, set] = useSettings();
  const isDark = typeof document !== "undefined" && (document.documentElement.dataset.theme === "night" || document.documentElement.dataset.theme === "ink");

  return (
    <div>
      <div className="mb-4">
        <Segmented
          label="Settings section"
          value={tab}
          onChange={setTab}
          options={[
            { value: "look", label: "Look" },
            { value: "text", label: "Text" },
            { value: "answers", label: "Answers" },
          ]}
        />
      </div>

      {tab === "look" && (
        <div className="space-y-3.5">
          <div>
            <p className="mb-2.5 text-[12.5px] text-ink-3">Theme</p>
            <div className="grid grid-cols-6 gap-2">
              {THEMES.map((t) => {
                const on = s.theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    data-tip={t.tip}
                    onClick={() => set({ theme: t.id })}
                    className="group flex flex-col items-center gap-1.5 rounded-[12px] focus-visible:outline-offset-4"
                  >
                    <span
                      className={`relative flex h-[38px] w-full overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_rgb(128_128_128/0.28)] outline-2 outline-offset-2 transition-[outline-color] [outline-style:solid] ${
                        on ? "outline-[var(--ink)]" : "outline-transparent group-hover:outline-[var(--rule-strong)]"
                      }`}
                    >
                      {t.id === "auto" ? (
                        <>
                          <span className="flex flex-1 items-center justify-end" style={{ background: "#f6f3ec", color: "#1d1b18" }}>
                            <span className="relative font-serif text-[15px] leading-none [font-variation-settings:'opsz'_36]">
                              A<span className="absolute -bottom-[5px] left-0 right-0 h-[2px] rounded-full" style={{ background: "var(--pen-l)" }} />
                            </span>
                          </span>
                          <span className="flex flex-1 items-center justify-start" style={{ background: "#151412", color: "#e9e3d6" }}>
                            <span className="relative font-serif text-[15px] leading-none [font-variation-settings:'opsz'_36]">
                              a<span className="absolute -bottom-[5px] left-0 right-0 h-[2px] rounded-full" style={{ background: "var(--pen-d)" }} />
                            </span>
                          </span>
                        </>
                      ) : (
                        <span className="flex flex-1 items-center justify-center" style={{ background: t.bg, color: t.fg }}>
                          <span className="relative font-serif text-[15px] leading-none [font-variation-settings:'opsz'_36]">
                            Aa
                            <span className="absolute -bottom-[5px] left-0 right-0 h-[2px] rounded-full" style={{ background: t.dark ? "var(--pen-d)" : "var(--pen-l)" }} />
                          </span>
                        </span>
                      )}
                    </span>
                    <span className={`text-[11px] leading-none transition-colors ${on ? "font-medium text-ink" : "text-ink-3 group-hover:text-ink-2"}`}>{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">Pen</span>
            <div className="flex items-center gap-2">
              {PENS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={s.pen === p.id}
                  aria-label={`${p.label} pen`}
                  data-tip={p.label}
                  onClick={() => set({ pen: p.id })}
                  className={`grid size-7 place-items-center rounded-full transition-[box-shadow,transform] active:scale-90 ${
                    s.pen === p.id ? "shadow-[0_0_0_2px_var(--bg-raised),0_0_0_3.5px_var(--ink-3)]" : ""
                  }`}
                >
                  <span className="size-5 rounded-full" style={{ background: isDark ? p.d : p.l }} />
                </button>
              ))}
              <span className="ml-1 text-[12px] text-ink-3">{PENS.find((p) => p.id === s.pen)?.label}</span>
            </div>
          </div>

          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">Highlighter</span>
            <div className="flex items-center gap-2">
              {MARKERS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={s.marker === m.id}
                  aria-label={`${m.label} highlighter`}
                  data-tip={m.label}
                  onClick={() => set({ marker: m.id })}
                  className={`grid size-7 place-items-center rounded-full transition-[box-shadow,transform] active:scale-90 ${
                    s.marker === m.id ? "shadow-[0_0_0_2px_var(--bg-raised),0_0_0_3.5px_var(--ink-3)]" : ""
                  }`}
                >
                  <span className="h-3 w-5 -rotate-12 rounded-[3px] opacity-80" style={{ background: m.c }} />
                </button>
              ))}
              <span className="ml-1 text-[12px] text-ink-3">{MARKERS.find((m) => m.id === s.marker)?.label}</span>
            </div>
          </div>

          {reader && (
            <div className="grid grid-cols-2 gap-1.5 border-t border-rule pt-3.5">
              <SwitchButton checked={s.numbers} onChange={(v) => set({ numbers: v })}>
                <Pilcrow size={14} aria-hidden="true" /> Numbers
              </SwitchButton>
              <SwitchButton checked={s.rail} onChange={(v) => set({ rail: v })}>
                <Map size={14} aria-hidden="true" /> Map
              </SwitchButton>
              <SwitchButton checked={s.focus} onChange={(v) => set({ focus: v })}>
                <Focus size={14} aria-hidden="true" /> Focus
              </SwitchButton>
              <SwitchButton checked={s.listen} onChange={(v) => set({ listen: v })}>
                <Headphones size={14} aria-hidden="true" /> Listen
              </SwitchButton>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 border-t border-rule pt-3.5">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
                <Paintbrush size={13} aria-hidden="true" /> Painted covers
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">A picture for each text in your library. Not available in this build.</p>
            </div>
            <Toggle checked={s.covers} onChange={(v) => set({ covers: v })} label="Painted covers" />
          </div>
        </div>
      )}

      {tab === "text" && (
        <div className="space-y-3.5">
          <div>
            <p className="mb-2.5 text-[12.5px] text-ink-3">Typeface</p>
            <div className="grid grid-cols-4 gap-2">
              {FACES.map((f) => {
                const on = s.face === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set({ face: f.id })}
                    className={`group flex h-[62px] flex-col items-center justify-center gap-1 rounded-[12px] border transition-[border-color,background-color,transform] active:scale-[0.97] ${
                      on ? "border-ink bg-bg" : "border-rule hover:border-rule-strong"
                    }`}
                  >
                    <span className="text-[22px] leading-none text-ink" style={{ fontFamily: f.font }}>
                      Ag
                    </span>
                    <span className={`text-[11px] leading-none ${on ? "font-medium text-ink" : "text-ink-3"}`}>{f.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">Size</span>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label="Smaller text" data-tip="Smaller" onClick={() => set({ size: Math.max(15, s.size - 1) })} className="grid size-7 place-items-center rounded-lg text-ink-2 transition-transform hover:bg-sunk active:scale-90">
                <Minus size={14} aria-hidden="true" />
              </button>
              <input type="range" min={15} max={28} value={s.size} aria-label="Text size" onChange={(e) => set({ size: Number(e.target.value) })} className="h-1 min-w-0 flex-1 accent-[var(--rubric)]" />
              <button type="button" aria-label="Larger text" data-tip="Larger" onClick={() => set({ size: Math.min(28, s.size + 1) })} className="grid size-7 place-items-center rounded-lg text-ink-2 transition-transform hover:bg-sunk active:scale-90">
                <Plus size={14} aria-hidden="true" />
              </button>
              <span className="w-6 text-right text-[12px] tabular-nums text-ink-3">{s.size}</span>
            </div>
          </div>
          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">Spacing</span>
            <Segmented label="Line spacing" value={s.leading} onChange={(v) => set({ leading: v })} options={[{ value: "snug", label: "Snug" }, { value: "normal", label: "Even" }, { value: "airy", label: "Airy" }]} />
          </div>
          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">Width</span>
            <Segmented label="Column width" value={s.width} onChange={(v) => set({ width: v })} options={[{ value: "narrow", label: "Narrow" }, { value: "normal", label: "Even" }, { value: "wide", label: "Wide" }]} />
          </div>
          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">Align</span>
            <Segmented
              label="Text alignment"
              value={s.align}
              onChange={(v) => set({ align: v })}
              options={[
                { value: "left", label: (<><AlignLeft size={13} aria-hidden="true" /> Left</>) },
                { value: "justify", label: (<><AlignJustify size={13} aria-hidden="true" /> Justified</>) },
              ]}
            />
          </div>
          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">Paragraphs</span>
            <Segmented label="Paragraph style" value={s.paras} onChange={(v) => set({ paras: v })} options={[{ value: "spaced", label: "Spaced" }, { value: "indented", label: "Indented" }]} />
          </div>
        </div>
      )}

      {tab === "answers" && (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[12.5px] text-ink-3">Answer length</p>
            <Segmented label="Answer length" value={s.length} onChange={(v) => set({ length: v })} options={[{ value: "short", label: "Short" }, { value: "normal", label: "Balanced" }, { value: "long", label: "Detailed" }]} />
            <p className="mt-2 text-[12px] leading-snug text-ink-4">{s.length === "short" ? "A sentence or two." : s.length === "long" ? "Several paragraphs, with more context." : "About a paragraph."}</p>
          </div>
          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3 border-t border-rule pt-3.5">
            <span className="text-[12.5px] text-ink-3">Web</span>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] leading-snug text-ink-3">Let whole-text questions look things up on the web when available.</span>
              <Toggle checked={s.search} onChange={(v) => set({ search: v })} label="Search the web" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
