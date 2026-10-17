"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Pause, Play, RotateCcw, SkipBack, SkipForward, Square } from "lucide-react";
import type { SpeechSnapshot } from "@/lib/speech/controller";

interface Props {
  snap: SpeechSnapshot;
  voices: SpeechSynthesisVoice[];
  onToggle: () => void;
  onStop: () => void;
  onRestart: () => void;
  onSkip: (d: number) => void;
  onRate: (r: number) => void;
  onVoice: (uri: string | null) => void;
  docLang?: string;
}

const RATES = [0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];

/** Floating read-aloud bar: play/pause, stop, restart, skip, speed, voice. */
export function ListenBar({ snap, voices, onToggle, onStop, onRestart, onSkip, onRate, onVoice, docLang }: Props) {
  const [voicesOpen, setVoicesOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!voicesOpen) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setVoicesOpen(false);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [voicesOpen]);

  if (snap.state === "idle" || snap.state === "unsupported") return null;
  const pct = snap.total ? Math.round(((snap.index + 1) / snap.total) * 100) : 0;
  const voice = voices.find((v) => v.voiceURI === snap.voiceURI) ?? null;
  const sorted = [...voices].sort((a, b) => Number((b.lang || "").startsWith((docLang || "en").slice(0, 2))) - Number((a.lang || "").startsWith((docLang || "en").slice(0, 2))) || a.name.localeCompare(b.name));

  return (
    <div ref={ref} role="region" aria-label="Reading aloud" className="fixed bottom-[calc(env(safe-area-inset-bottom)+80px)] left-1/2 z-[46] flex -translate-x-1/2 items-center gap-1 rounded-full bg-lens p-1 text-lens-fg shadow-pop ring-1 ring-black/5 sm:bottom-[calc(env(safe-area-inset-bottom)+90px)]" style={{ animation: "rise 0.35s var(--ease-out) both" }} data-tip-tone="paper">
      <button type="button" aria-label="Back one sentence" data-tip="Back a sentence" className="grid size-9 place-items-center rounded-full text-lens-fg/80 transition-colors hover:bg-lens-hover hover:text-lens-fg" onClick={() => onSkip(-1)}>
        <SkipBack size={14} aria-hidden="true" />
      </button>
      <button type="button" aria-label={snap.state === "playing" ? "Pause" : "Resume"} data-tip={snap.state === "playing" ? "Pause" : "Resume"} data-tip-kbd="Space" className="grid size-9 place-items-center rounded-full bg-lens-fg/10 text-lens-fg transition-colors hover:bg-lens-hover" onClick={onToggle}>
        {snap.state === "playing" ? <Pause size={15} fill="currentColor" aria-hidden="true" /> : <Play size={15} fill="currentColor" aria-hidden="true" />}
      </button>
      <button type="button" aria-label="Forward one sentence" data-tip="Forward a sentence" className="grid size-9 place-items-center rounded-full text-lens-fg/80 transition-colors hover:bg-lens-hover hover:text-lens-fg" onClick={() => onSkip(1)}>
        <SkipForward size={14} aria-hidden="true" />
      </button>
      <span className="max-w-[min(260px,40vw)] truncate px-2 text-[12.5px] tabular-nums text-lens-mute" title={snap.segment?.text}>
        {snap.state === "error" ? <span className="text-lens-fg">{snap.error}</span> : <>{snap.passage ? "Passage" : "Reading"} · {snap.index + 1}/{snap.total} · {pct}%</>}
      </span>
      <select aria-label="Speed" value={String(snap.rate)} onChange={(e) => onRate(Number(e.target.value))} className="h-8 cursor-pointer appearance-none rounded-full bg-transparent px-2 text-[12.5px] font-medium tabular-nums text-lens-fg hover:bg-lens-hover">
        {RATES.map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
        {!RATES.includes(snap.rate) ? <option value={snap.rate}>{snap.rate}×</option> : null}
      </select>
      <div className="relative">
        <button type="button" aria-haspopup="listbox" aria-expanded={voicesOpen} data-tip="Voice" className="flex h-8 max-w-[150px] items-center gap-1 rounded-full px-2.5 text-[12.5px] text-lens-fg/85 hover:bg-lens-hover hover:text-lens-fg" onClick={() => setVoicesOpen((v) => !v)}>
          <span className="truncate">{voice ? voice.name.replace(/\(.*?\)/g, "").trim() : "System voice"}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        {voicesOpen ? (
          <ul role="listbox" aria-label="Voices" className="lens-menu scroll-thin absolute bottom-[calc(100%+8px)] right-0 max-h-[280px] w-[260px] overflow-y-auto rounded-[14px] bg-lens p-1 shadow-pop ring-1 ring-black/5">
            <li role="option" aria-selected={!snap.voiceURI}>
              <button type="button" className={`w-full rounded-[9px] px-2.5 py-1.5 text-left text-[12.5px] hover:bg-lens-hover ${!snap.voiceURI ? "text-lens-fg" : "text-lens-mute"}`} onClick={() => { onVoice(null); setVoicesOpen(false); }}>
                System default
              </button>
            </li>
            {sorted.map((v) => (
              <li key={v.voiceURI} role="option" aria-selected={v.voiceURI === snap.voiceURI}>
                <button type="button" className={`w-full rounded-[9px] px-2.5 py-1.5 text-left text-[12.5px] hover:bg-lens-hover ${v.voiceURI === snap.voiceURI ? "text-lens-fg" : "text-lens-mute"}`} onClick={() => { onVoice(v.voiceURI); setVoicesOpen(false); }}>
                  <span className="block truncate">{v.name}</span>
                  <span className="block text-[11px] opacity-70">{v.lang}{v.localService ? "" : " · online"}</span>
                </button>
              </li>
            ))}
            {!voices.length ? <li className="px-2.5 py-2 text-[12px] text-lens-mute">No voices reported by this browser yet.</li> : null}
          </ul>
        ) : null}
      </div>
      <button type="button" aria-label="Restart" data-tip="From the start" className="grid size-9 place-items-center rounded-full text-lens-fg/80 transition-colors hover:bg-lens-hover hover:text-lens-fg" onClick={onRestart}>
        <RotateCcw size={13} aria-hidden="true" />
      </button>
      <button type="button" aria-label="Stop reading aloud" data-tip="Stop" className="grid size-9 place-items-center rounded-full text-lens-fg/80 transition-colors hover:bg-lens-hover hover:text-lens-fg" onClick={onStop}>
        <Square size={13} fill="currentColor" aria-hidden="true" />
      </button>
    </div>
  );
}
