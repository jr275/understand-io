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
const BTN = "grid size-9 place-items-center rounded-full text-lens-fg/80 transition-colors hover:bg-lens-hover hover:text-lens-fg disabled:pointer-events-none disabled:opacity-35";

/** What a screen reader should hear for the current state (derived, so there is no state to keep in sync). */
function announcementFor(snap: SpeechSnapshot) {
  if (snap.state === "playing") return "Reading aloud";
  if (snap.state === "paused") return "Paused";
  if (snap.state === "error") return snap.error ?? "Reading stopped because of an error";
  if (snap.state === "idle") return snap.endedBy === "completed" ? "Finished reading" : snap.endedBy === "stopped" ? "Stopped reading" : "";
  return "";
}

/**
 * Floating read-aloud bar. The live region is always mounted (the bar itself unmounts when reading ends, which would
 * swallow the "Finished" announcement), and the controls are a separate component so their state, such as an open voice
 * menu, resets whenever a session ends.
 */
export function ListenBar(props: Props) {
  const hidden = props.snap.state === "idle" || props.snap.state === "unsupported";
  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {announcementFor(props.snap)}
      </span>
      {hidden ? null : <ListenControls {...props} />}
    </>
  );
}

function ListenControls({ snap, voices, onToggle, onStop, onRestart, onSkip, onRate, onVoice, docLang }: Props) {
  const [voicesOpen, setVoicesOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!voicesOpen) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setVoicesOpen(false);
    document.addEventListener("pointerdown", onDown);
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    (menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? items?.[0])?.focus();
    return () => document.removeEventListener("pointerdown", onDown);
  }, [voicesOpen]);

  const closeMenu = (returnFocus: boolean) => {
    setVoicesOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  };
  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenu(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items.at(-1)?.focus();
    } else if (e.key === "Tab") setVoicesOpen(false);
  };

  const shown = snap.passage ? { i: snap.index + 1, n: snap.total } : { i: snap.offset + snap.index + 1, n: snap.grand || snap.total };
  const pct = shown.n ? Math.round((shown.i / shown.n) * 100) : 0;
  const voice = voices.find((v) => v.voiceURI === snap.voiceURI) ?? null;
  const prefix = (docLang || "en").slice(0, 2);
  const sorted = [...voices].sort((a, b) => Number((b.lang || "").startsWith(prefix)) - Number((a.lang || "").startsWith(prefix)) || a.name.localeCompare(b.name));
  const voiceName = voice ? voice.name.replace(/\(.*?\)/g, "").trim() : "System voice";
  const failed = snap.state === "error";
  const item = (checked: boolean) => `w-full rounded-[9px] px-2.5 py-1.5 text-left text-[12.5px] hover:bg-lens-hover focus-visible:bg-lens-hover ${checked ? "text-lens-fg" : "text-lens-mute"}`;

  return (
    <>
      <div ref={ref} role="region" aria-label="Reading aloud" className="fixed bottom-[calc(env(safe-area-inset-bottom)+80px)] left-1/2 z-[46] flex -translate-x-1/2 items-center gap-1 rounded-full bg-lens p-1 text-lens-fg shadow-pop ring-1 ring-black/5 sm:bottom-[calc(env(safe-area-inset-bottom)+90px)]" style={{ animation: "rise 0.35s var(--ease-out) both" }} data-tip-tone="paper">
        <button type="button" aria-label="Back one sentence" data-tip="Back a sentence" disabled={snap.atStart} className={BTN} onClick={() => onSkip(-1)}>
          <SkipBack size={14} aria-hidden="true" />
        </button>
        <button type="button" aria-label={failed ? "Try again" : snap.state === "playing" ? "Pause" : "Resume"} data-tip={failed ? "Try again" : snap.state === "playing" ? "Pause" : "Resume"} data-tip-kbd="Space" className="grid size-9 place-items-center rounded-full bg-lens-fg/10 text-lens-fg transition-colors hover:bg-lens-hover" onClick={onToggle}>
          {snap.state === "playing" ? <Pause size={15} fill="currentColor" aria-hidden="true" /> : failed ? <RotateCcw size={14} aria-hidden="true" /> : <Play size={15} fill="currentColor" aria-hidden="true" />}
        </button>
        <button type="button" aria-label="Forward one sentence" data-tip="Forward a sentence" disabled={snap.atEnd} className={BTN} onClick={() => onSkip(1)}>
          <SkipForward size={14} aria-hidden="true" />
        </button>
        <span className="max-w-[min(260px,40vw)] truncate px-2 text-[12.5px] tabular-nums text-lens-mute" title={snap.error ?? snap.segment?.text}>
          {failed ? <span className="text-lens-fg">{snap.error}</span> : <>{snap.passage ? "Passage" : "Reading"} · {shown.i}/{shown.n} · {pct}%</>}
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
          <button ref={triggerRef} type="button" aria-label={`Voice: ${voiceName}`} aria-haspopup="menu" aria-expanded={voicesOpen} data-tip="Voice" className="flex h-8 max-w-[150px] items-center gap-1 rounded-full px-2.5 text-[12.5px] text-lens-fg/85 hover:bg-lens-hover hover:text-lens-fg" onClick={() => setVoicesOpen((v) => !v)}>
            <span className="truncate">{voiceName}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          {voicesOpen ? (
            <div ref={menuRef} role="menu" aria-label="Voices" onKeyDown={onMenuKey} className="lens-menu scroll-thin absolute bottom-[calc(100%+8px)] right-0 max-h-[280px] w-[260px] overflow-y-auto rounded-[14px] bg-lens p-1 shadow-pop ring-1 ring-black/5">
              <button type="button" role="menuitemradio" aria-checked={!snap.voiceURI} className={item(!snap.voiceURI)} onClick={() => { onVoice(null); closeMenu(true); }}>
                System default
              </button>
              {sorted.map((v) => (
                <button key={v.voiceURI} type="button" role="menuitemradio" aria-checked={v.voiceURI === snap.voiceURI} className={item(v.voiceURI === snap.voiceURI)} onClick={() => { onVoice(v.voiceURI); closeMenu(true); }}>
                  <span className="block truncate">{v.name}</span>
                  <span className="block text-[11px] opacity-70">{v.lang}{v.localService ? "" : " · online"}</span>
                </button>
              ))}
              {!voices.length ? <p className="px-2.5 py-2 text-[12px] text-lens-mute">No voices reported by this browser yet.</p> : null}
            </div>
          ) : null}
        </div>
        <button type="button" aria-label="Restart" data-tip="From the start" className={BTN} onClick={onRestart}>
          <RotateCcw size={13} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Stop reading aloud" data-tip="Stop" className={BTN} onClick={onStop}>
          <Square size={13} fill="currentColor" aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
