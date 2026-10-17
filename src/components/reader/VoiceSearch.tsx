"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Headphones, Mic, MicOff, Search, X } from "lucide-react";
import type { Block } from "@/lib/content/types";
import { Bm25Index, buildPassages, parseSpokenQuery, type Hit, type SearchResult } from "@/lib/search/bm25";
import { getRecognitionCtor, recordAudio, startRecognition } from "@/lib/speech/recognition";
import { getUserKey } from "@/lib/store/library";

interface Props {
  open: boolean;
  onClose: () => void;
  blocks: Block[];
  lang: string;
  onJump: (hit: Hit) => void;
  onRead: (hit: Hit) => void;
  serverKey: boolean;
}

type Phase = "idle" | "listening" | "transcribing" | "searching" | "done";

/**
 * Ask aloud where something is discussed. Recognition → editable transcript → search within
 * the document (BM25, plus embedding re-rank when a key is available) → ranked passages.
 */
export function VoiceSearch({ open, onClose, blocks, lang, onJump, onRead, serverKey }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<(SearchResult & { topic: string; readAloud: boolean }) | null>(null);
  const [level, setLevel] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);
  const searchRef = useRef<(q: string) => Promise<void>>(async () => {});
  const inputRef = useRef<HTMLInputElement>(null);
  const index = useMemo(() => new Bm25Index(buildPassages(blocks)), [blocks]);
  const supported = typeof window !== "undefined" && !!getRecognitionCtor();
  const canServerTranscribe = serverKey || !!getUserKey();

  const search = useCallback(
    async (raw: string) => {
      const { topic, readAloud } = parseSpokenQuery(raw);
      setPhase("searching");
      const lexical = index.search(topic, 12);
      let final: SearchResult = lexical;
      const key = getUserKey();
      if ((serverKey || key) && lexical.hits.length) {
        try {
          const cands = lexical.hits.slice(0, 20).map((h, i) => ({ key: String(i), text: h.excerpt }));
          const res = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-gloss-key": key } : {}) }, body: JSON.stringify({ q: topic, passages: cands }) });
          if (res.ok) {
            const j = (await res.json()) as { scores: { key: string; score: number }[] };
            const sem = new Map(j.scores.map((s) => [s.key, s.score]));
            const hits = lexical.hits
              .slice(0, 20)
              .map((h, i) => ({ ...h, score: 0.55 * h.rel + 0.45 * (sem.get(String(i)) ?? 0) }))
              .sort((a, b) => b.score - a.score)
              .slice(0, 8);
            const best = hits[0]?.score ?? 0;
            final = { ...lexical, hits: hits.map((h) => ({ ...h, rel: best ? h.score / best : 0 })), mode: "hybrid", confidence: best > 0.72 ? "high" : best > 0.5 ? lexical.confidence === "none" ? "low" : lexical.confidence : "low" };
          }
        } catch {
          /* lexical result stands */
        }
      }
      setResult({ ...final, topic, readAloud });
      setPhase("done");
      if (readAloud && final.hits[0] && final.confidence === "high") onRead(final.hits[0]);
    },
    [index, serverKey, onRead],
  );

  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  const stopListening = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  const listen = useCallback(async () => {
    setError(null);
    setResult(null);
    setTranscript("");
    setInterim("");
    if (supported) {
      setPhase("listening");
      const stop = startRecognition(lang, {
        onInterim: (t) => {
          setInterim(t);
          setDraft(t);
        },
        onFinal: (t) => {
          setTranscript(t);
          setDraft(t);
          setInterim("");
          stopRef.current?.();
          stopRef.current = null;
          void searchRef.current(t);
        },
        onError: (msg, code) => {
          if (code !== "aborted") setError(msg);
          setPhase("idle");
        },
        onEnd: () => {
          setPhase((ph) => (ph === "listening" ? "idle" : ph));
          stopRef.current = null;
        },
      });
      stopRef.current = stop;
      return;
    }
    if (!canServerTranscribe) {
      setError("This browser has no speech recognition, and server transcription needs a Together AI key. Type your question instead.");
      return;
    }
    try {
      setPhase("listening");
      const rec = await recordAudio(12000);
      // crude level meter
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(rec.stream);
      const an = ctx.createAnalyser();
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += Math.abs(v - 128);
        setLevel(Math.min(1, sum / buf.length / 40));
        if (stopRef.current) requestAnimationFrame(tick);
      };
      const finish = async (blob: Blob) => {
          setPhase("transcribing");
          const fd = new FormData();
          fd.append("audio", blob);
          fd.append("language", lang);
          const key = getUserKey();
          const res = await fetch("/api/speech/transcribe", { method: "POST", headers: key ? { "x-gloss-key": key } : undefined, body: fd });
          const j = (await res.json().catch(() => ({}))) as { text?: string; message?: string };
          if (!res.ok || !j.text) {
            setError(j.message || "Transcription failed.");
            setPhase("idle");
            return;
          }
          setTranscript(j.text);
          setDraft(j.text);
          setPhase("idle");
      };
      stopRef.current = () => {
        stopRef.current = null;
        void ctx.close();
        void rec.stop().then(finish);
      };
      // The recorder stops itself after 12 s; make sure the UI follows.
      rec.done.then((blob) => {
        if (stopRef.current) {
          stopRef.current = null;
          void ctx.close();
          void finish(blob);
        }
      });
      requestAnimationFrame(tick);
    } catch (e) {
      setError(e instanceof Error && e.name === "NotAllowedError" ? "Microphone access was denied. Allow the microphone for this site and try again." : "Could not start the microphone.");
      setPhase("idle");
    }
  }, [supported, canServerTranscribe, lang]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      stopListening();
    };
  }, [open, onClose, stopListening]);

  if (!open) return null;
  const shown = interim || transcript;
  void shown;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-start justify-center p-4 pt-[calc(var(--topbar-h)+20px)]">
      <div className="absolute inset-0 bg-[color-mix(in_oklab,var(--bg)_55%,transparent)] backdrop-blur-[3px]" style={{ animation: "fade .25s var(--ease-out)" }} onPointerDown={onClose} />
      <section role="dialog" aria-modal="true" aria-label="Ask by voice" className="pop relative w-full max-w-[560px] p-5" style={{ ["--origin" as string]: "top center" }}>
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="font-serif text-[21px] leading-tight text-ink">Where does it talk about…</p>
            <p className="mt-1 text-[13px] text-ink-3">Ask aloud, or type. Understand.io searches this text only, and says so when nothing matches.</p>
          </div>
          <button type="button" aria-label="Close" data-tip="Close" data-tip-kbd="Esc" className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink" onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            aria-pressed={phase === "listening"}
            aria-label={phase === "listening" ? "Stop listening" : "Start listening"}
            className={`relative grid size-12 shrink-0 place-items-center rounded-full transition-colors ${phase === "listening" ? "bg-[var(--rubric)] text-white" : "bg-ink text-bg hover:opacity-90"}`}
            onClick={() => (phase === "listening" ? stopListening() : void listen())}
          >
            {phase === "listening" ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
            {phase === "listening" ? <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-[var(--rubric)] opacity-30" /> : null}
          </button>
          <form
            className="flex min-w-0 flex-1 items-center gap-2 rounded-[14px] border border-rule bg-bg px-3 transition-colors focus-within:border-rule-strong"
            onSubmit={(e) => {
              e.preventDefault();
              const q = draft.trim();
              if (q) {
                stopListening();
                setTranscript(q);
                void search(q);
              }
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={phase === "listening" ? "Listening…" : phase === "transcribing" ? "Transcribing…" : "Find the part that talks about…"}
              aria-label="What to look for"
              className="h-11 min-w-0 flex-1 bg-transparent font-serif text-[16px] text-ink outline-none placeholder:text-ink-4 focus-visible:outline-none"
            />
            {!supported && phase === "listening" ? (
              <span className="flex h-5 items-end gap-[2px]" aria-hidden="true">
                {[0.4, 0.8, 1, 0.7, 0.5].map((f, i) => (
                  <span key={i} className="voice-level" style={{ height: 4 + level * 16 * f }} />
                ))}
              </span>
            ) : null}
            <button type="submit" aria-label="Search" className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-ink text-bg">
              <Search size={14} aria-hidden="true" />
            </button>
          </form>
        </div>
        {shown && phase !== "done" ? <p className="mt-2 text-[12.5px] text-ink-3">Heard: <span className="text-ink">“{shown}”</span></p> : null}
        {error ? <p className="mt-3 rounded-[10px] bg-rubric-wash px-3 py-2 text-[13px] text-rubric-text">{error}</p> : null}
        {!supported && phase === "idle" && !error ? (
          <p className="mt-2 text-[12px] text-ink-4">{canServerTranscribe ? "This browser has no built-in speech recognition; your voice is transcribed on the server." : "This browser has no built-in speech recognition. Type your question, or add a Together key for server transcription."}</p>
        ) : null}

        {phase === "searching" ? <div className="loading-bar mt-5" aria-label="Searching" /> : null}

        {result && phase === "done" ? (
          <div className="mt-4">
            <p className="text-[12.5px] text-ink-3">
              {result.confidence === "none" ? (
                <>No passage in this text matches <span className="text-ink">“{result.topic}”</span>. Try other words, or ask about the whole text instead.</>
              ) : (
                <>
                  {result.confidence === "low" ? "Possible matches for " : "Matches for "}
                  <span className="text-ink">“{result.topic}”</span>
                  {result.confidence === "low" ? " — none is a confident hit." : ""}
                  <span className="text-ink-4"> · {result.mode === "hybrid" ? "words + meaning" : "words only"}</span>
                </>
              )}
            </p>
            {result.hits.length ? (
              <ol className="mt-3 space-y-2">
                {result.hits.slice(0, 6).map((h, i) => (
                  <li key={`${h.blockId}:${h.start}`} className="group flex items-start gap-2 rounded-[14px] border border-rule bg-bg px-3.5 py-3 transition-colors hover:border-rule-strong">
                    <span className="mt-0.5 shrink-0 text-[11.5px] tabular-nums text-ink-4">{i + 1}</span>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { onJump(h); onClose(); }}>
                      <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
                        {h.n ? <span className="cite pointer-events-none !m-0 !text-[11px]">¶{h.n}</span> : null}
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-rule">
                          <span className="block h-full rounded-full bg-[var(--rubric)]" style={{ width: `${Math.round(h.rel * 100)}%` }} />
                        </span>
                      </span>
                      <span className="mt-1.5 line-clamp-3 font-serif text-[15px] leading-[1.45] text-ink-2 group-hover:text-ink">{highlightExcerpt(h.excerpt, result.queryTokens)}</span>
                    </button>
                    <button type="button" aria-label="Read this passage aloud" data-tip="Read aloud" className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-sunk hover:text-ink" onClick={() => { onRead(h); onClose(); }}>
                      <Headphones size={14} aria-hidden="true" />
                    </button>
                    <button type="button" aria-label="Go to this passage" data-tip="Go there" className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-sunk hover:text-ink" onClick={() => { onJump(h); onClose(); }}>
                      <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
        <p className="mt-4 text-[11.5px] leading-snug text-ink-4">Try: “find the part about the sea floor” · “where does the author explain the main argument” · “encontre a conclusão e leia esse trecho”.</p>
      </section>
    </div>
  );
}

function highlightExcerpt(text: string, tokens: string[]) {
  if (!tokens.length) return text;
  const stems = tokens.filter((t) => t.length > 2);
  if (!stems.length) return text;
  const re = new RegExp(`(\\b(?:${stems.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\w*)`, "gi");
  const parts = text.split(re);
  return parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="hit-mark">{p}</span> : p));
}
