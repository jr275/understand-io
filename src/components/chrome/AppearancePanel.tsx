"use client";

import { useState } from "react";
import { AlignJustify, AlignLeft, Focus, Headphones, Keyboard, Map, Minus, Paintbrush, Pilcrow, Plus } from "lucide-react";
import { Segmented } from "@/components/ui/Segmented";
import { SwitchButton, Toggle } from "@/components/ui/Switch";
import { useSettings, type Face, type Pen, type Theme } from "@/lib/store/settings";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/translate";

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

const THEME_KEY: Record<string, MessageKey> = { auto: "appearance.themeAuto", paper: "appearance.themePaper", sepia: "appearance.themeSepia", snow: "appearance.themeSnow", night: "appearance.themeNight", ink: "appearance.themeInk" };
const PEN_KEY: Record<string, MessageKey> = { vermilion: "appearance.penVermilion", cobalt: "appearance.penCobalt", moss: "appearance.penMoss", graphite: "appearance.penGraphite" };
const MARKER_KEY: Record<string, MessageKey> = { yellow: "appearance.markYellow", green: "appearance.markGreen", blue: "appearance.markBlue", pink: "appearance.markPink" };
const FACE_KEY: Record<string, MessageKey> = { serif: "appearance.faceSerif", book: "appearance.faceBook", sans: "appearance.faceSans", legible: "appearance.faceLegible" };

export function AppearancePanel({ reader = false }: { reader?: boolean }) {
  const t = useT();
  const [tab, setTab] = useState<"look" | "text" | "answers">("look");
  const [s, set] = useSettings();
  // The panel only renders after the user opens it, so reading the browser here cannot cause a hydration mismatch.
  const ttsOk = typeof window === "undefined" || "speechSynthesis" in window;
  const isDark = typeof document !== "undefined" && (document.documentElement.dataset.theme === "night" || document.documentElement.dataset.theme === "ink");

  return (
    <div>
      <div className="mb-4">
        <Segmented
          label={t("appearance.sections")}
          value={tab}
          onChange={setTab}
          options={[
            { value: "look", label: t("appearance.tabLook") },
            { value: "text", label: t("appearance.tabText") },
            { value: "answers", label: t("appearance.tabAnswers") },
          ]}
        />
      </div>

      {tab === "look" && (
        <div className="space-y-3.5">
          <div>
            <p className="mb-2.5 text-[12.5px] text-ink-3">{t("appearance.theme")}</p>
            <div className="grid grid-cols-6 gap-2">
              {THEMES.map((th) => {
                const on = s.theme === th.id;
                return (
                  <button
                    key={th.id}
                    type="button"
                    aria-pressed={on}
                    data-tip={th.id === "auto" ? t("appearance.themeAutoTip") : undefined}
                    onClick={() => set({ theme: th.id })}
                    className="group flex flex-col items-center gap-1.5 rounded-[12px] focus-visible:outline-offset-4"
                  >
                    <span
                      className={`relative flex h-[38px] w-full overflow-hidden rounded-[10px] shadow-[inset_0_0_0_1px_rgb(128_128_128/0.28)] outline-2 outline-offset-2 transition-[outline-color] [outline-style:solid] ${
                        on ? "outline-[var(--ink)]" : "outline-transparent group-hover:outline-[var(--rule-strong)]"
                      }`}
                    >
                      {th.id === "auto" ? (
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
                        <span className="flex flex-1 items-center justify-center" style={{ background: th.bg, color: th.fg }}>
                          <span className="relative font-serif text-[15px] leading-none [font-variation-settings:'opsz'_36]">
                            Aa
                            <span className="absolute -bottom-[5px] left-0 right-0 h-[2px] rounded-full" style={{ background: th.dark ? "var(--pen-d)" : "var(--pen-l)" }} />
                          </span>
                        </span>
                      )}
                    </span>
                    <span className={`text-[11px] leading-none transition-colors ${on ? "font-medium text-ink" : "text-ink-3 group-hover:text-ink-2"}`}>{t(THEME_KEY[th.id])}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">{t("appearance.pen")}</span>
            <div className="flex items-center gap-2">
              {PENS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={s.pen === p.id}
                  aria-label={t("appearance.penName", { name: t(PEN_KEY[p.id]) })}
                  data-tip={t(PEN_KEY[p.id])}
                  onClick={() => set({ pen: p.id })}
                  className={`grid size-7 place-items-center rounded-full transition-[box-shadow,transform] active:scale-90 ${
                    s.pen === p.id ? "shadow-[0_0_0_2px_var(--bg-raised),0_0_0_3.5px_var(--ink-3)]" : ""
                  }`}
                >
                  <span className="size-5 rounded-full" style={{ background: isDark ? p.d : p.l }} />
                </button>
              ))}
              <span className="ml-1 text-[12px] text-ink-3">{t(PEN_KEY[s.pen])}</span>
            </div>
          </div>

          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">{t("appearance.highlighter")}</span>
            <div className="flex items-center gap-2">
              {MARKERS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={s.marker === m.id}
                  aria-label={t("appearance.highlighterName", { name: t(MARKER_KEY[m.id]) })}
                  data-tip={t(MARKER_KEY[m.id])}
                  onClick={() => set({ marker: m.id })}
                  className={`grid size-7 place-items-center rounded-full transition-[box-shadow,transform] active:scale-90 ${
                    s.marker === m.id ? "shadow-[0_0_0_2px_var(--bg-raised),0_0_0_3.5px_var(--ink-3)]" : ""
                  }`}
                >
                  <span className="h-3 w-5 -rotate-12 rounded-[3px] opacity-80" style={{ background: m.c }} />
                </button>
              ))}
              <span className="ml-1 text-[12px] text-ink-3">{t(MARKER_KEY[s.marker])}</span>
            </div>
          </div>

          {reader && (
            <div className="grid grid-cols-2 gap-1.5 border-t border-rule pt-3.5">
              <SwitchButton checked={s.numbers} onChange={(v) => set({ numbers: v })}>
                <Pilcrow size={14} aria-hidden="true" /> {t("appearance.numbers")}
              </SwitchButton>
              <SwitchButton checked={s.rail} onChange={(v) => set({ rail: v })}>
                <Map size={14} aria-hidden="true" /> {t("appearance.map")}
              </SwitchButton>
              <SwitchButton checked={s.focus} onChange={(v) => set({ focus: v })}>
                <Focus size={14} aria-hidden="true" /> {t("appearance.focus")}
              </SwitchButton>
              {ttsOk ? (
                <SwitchButton checked={s.listen} onChange={(v) => set({ listen: v })}>
                  <Headphones size={14} aria-hidden="true" /> {t("appearance.listen")}
                </SwitchButton>
              ) : null}
            </div>
          )}

          <div className="border-t border-rule pt-3.5">
            <SwitchButton checked={s.keys} onChange={(v) => set({ keys: v })}>
              <Keyboard size={14} aria-hidden="true" /> {t("appearance.shortcuts")}
            </SwitchButton>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-rule pt-3.5">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2">
                <Paintbrush size={13} aria-hidden="true" /> {t("appearance.covers")}
              </p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{t("appearance.coversHelp")}</p>
            </div>
            <Toggle checked={s.covers} onChange={(v) => set({ covers: v })} label={t("appearance.covers")} />
          </div>
        </div>
      )}

      {tab === "text" && (
        <div className="space-y-3.5">
          <div>
            <p className="mb-2.5 text-[12.5px] text-ink-3">{t("appearance.typeface")}</p>
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
                    <span className={`text-[11px] leading-none ${on ? "font-medium text-ink" : "text-ink-3"}`}>{t(FACE_KEY[f.id])}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">{t("appearance.size")}</span>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label={t("appearance.smaller")} data-tip={t("appearance.smallerTip")} onClick={() => set({ size: Math.max(15, s.size - 1) })} className="grid size-7 place-items-center rounded-lg text-ink-2 transition-transform hover:bg-sunk active:scale-90">
                <Minus size={14} aria-hidden="true" />
              </button>
              <input type="range" min={15} max={28} value={s.size} aria-label={t("appearance.textSize")} onChange={(e) => set({ size: Number(e.target.value) })} className="h-1 min-w-0 flex-1 accent-[var(--rubric)]" />
              <button type="button" aria-label={t("appearance.larger")} data-tip={t("appearance.largerTip")} onClick={() => set({ size: Math.min(28, s.size + 1) })} className="grid size-7 place-items-center rounded-lg text-ink-2 transition-transform hover:bg-sunk active:scale-90">
                <Plus size={14} aria-hidden="true" />
              </button>
              <span className="w-6 text-right text-[12px] tabular-nums text-ink-3">{s.size}</span>
            </div>
          </div>
          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">{t("appearance.spacing")}</span>
            <Segmented label={t("appearance.lineSpacing")} value={s.leading} onChange={(v) => set({ leading: v })} options={[{ value: "snug", label: t("appearance.snug") }, { value: "normal", label: t("appearance.even") }, { value: "airy", label: t("appearance.airy") }]} />
          </div>
          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">{t("appearance.width")}</span>
            <Segmented label={t("appearance.columnWidth")} value={s.width} onChange={(v) => set({ width: v })} options={[{ value: "narrow", label: t("appearance.narrow") }, { value: "normal", label: t("appearance.even") }, { value: "wide", label: t("appearance.wide") }]} />
          </div>
          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">{t("appearance.align")}</span>
            <Segmented
              label={t("appearance.textAlignment")}
              value={s.align}
              onChange={(v) => set({ align: v })}
              options={[
                { value: "left", label: (<><AlignLeft size={13} aria-hidden="true" /> {t("appearance.left")}</>) },
                { value: "justify", label: (<><AlignJustify size={13} aria-hidden="true" /> {t("appearance.justified")}</>) },
              ]}
            />
          </div>
          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3">
            <span className="text-[12.5px] text-ink-3">{t("appearance.paragraphs")}</span>
            <Segmented label={t("appearance.paragraphStyle")} value={s.paras} onChange={(v) => set({ paras: v })} options={[{ value: "spaced", label: t("appearance.spaced") }, { value: "indented", label: t("appearance.indented") }]} />
          </div>
        </div>
      )}

      {tab === "answers" && (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[12.5px] text-ink-3">{t("appearance.answerLength")}</p>
            <Segmented label={t("appearance.answerLength")} value={s.length} onChange={(v) => set({ length: v })} options={[{ value: "short", label: t("appearance.short") }, { value: "normal", label: t("appearance.balanced") }, { value: "long", label: t("appearance.detailed") }]} />
            <p className="mt-2 text-[12px] leading-snug text-ink-4">{s.length === "short" ? t("appearance.shortHelp") : s.length === "long" ? t("appearance.longHelp") : t("appearance.normalHelp")}</p>
          </div>
          <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3 border-t border-rule pt-3.5">
            <span className="text-[12.5px] text-ink-3">{t("appearance.web")}</span>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12.5px] leading-snug text-ink-3">{t("appearance.webHelp")}</span>
              <Toggle checked={s.search} onChange={(v) => set({ search: v })} label={t("appearance.searchWeb")} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
