"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Headphones, Mic, MicOff, Search, X } from "lucide-react";
import type { Block } from "@/lib/content/types";
import { createIndex, parseSpokenQuery, type Hit, type SearchResult } from "@/lib/search/bm25";
import { tokenize } from "@/lib/search/tokenize";
import { FAILOVER_CODES, describeMicError, getRecognitionCtor, recordAudio, startRecognition } from "@/lib/speech/recognition";
import { getUserKey } from "@/lib/store/library";

interface Props {
  open: boolean;
  onClose: () => void;
  blocks: Block[];
  lang: string;
  onJump: (hit: Hit) => void;
  onRead: (hit: Hit) => void;
  /** Called when the microphone is about to be used, so read-aloud can step aside (it would be heard and searched for). */
  onListenStart?: () => void;
  serverKey: boolean;
}

type Phase = "idle" | "starting" | "listening" | "transcribing" | "searching" | "done";
type Result = SearchResult & { topic: string; readAloud: boolean; semanticFailed: boolean };

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Ask aloud where something is discussed. Recognition → editable transcript → search within
 * the document (BM25, plus embedding re-rank when a key is available) → ranked passages.
 *
 * Every capture is a "session". A session ends when it finishes, is stopped, is replaced, or the panel closes; from then on
 * every callback that belongs to it is ignored (so a late recognition result cannot search, speak or change the screen) and
 * the microphone is released.
 */
export function VoiceSearch({ open, onClose, blocks, lang, onJump, onRead, onListenStart, serverKey }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [transcript, setTranscript] = useState("");
  const [interim, setInterim] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [level, setLevel] = useState(0);
  const sessionRef = useRef(0);
  const stopRef = useRef<(() => void) | null>(null); // graceful: deliver what was heard
  const abortRef = useRef<(() => void) | null>(null); // hard: drop everything, release the microphone
  const searchSeq = useRef(0);
  const mounted = useRef(false);
  const typedWhileListening = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const cb = useRef({ onClose, onRead, onJump, onListenStart });
  useEffect(() => {
    cb.current = { onClose, onRead, onJump, onListenStart };
  });
  const index = useMemo(() => createIndex(blocks), [blocks]);
  const supported = typeof window !== "undefined" && !!getRecognitionCtor();
  const canServerTranscribe = serverKey || !!getUserKey();
  const hasKey = serverKey || !!getUserKey();

  const abortSession = useCallback(() => {
    sessionRef.current++;
    abortRef.current?.();
    abortRef.current = null;
    stopRef.current = null;
  }, []);
  const stopListening = useCallback(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  const search = useCallback(
    async (raw: string) => {
      const seq = ++searchSeq.current;
      const { topic, readAloud } = parseSpokenQuery(raw);
      setPhase("searching");
      const lexical = index.search(topic, 12);
      let final: SearchResult = lexical;
      let semanticFailed = false;
      const key = getUserKey();
      if ((serverKey || key) && lexical.hits.length) {
        try {
          const cands = lexical.hits.slice(0, 12).map((h, i) => ({ key: String(i), text: h.excerpt }));
          const res = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json", ...(key ? { "x-gloss-key": key } : {}) }, body: JSON.stringify({ q: topic, passages: cands }) });
          if (res.ok) {
            const j = (await res.json()) as { scores: { key: string; score: number }[] };
            const sem = new Map(j.scores.map((s) => [s.key, s.score]));
            const hits = lexical.hits
              .slice(0, 12)
              .map((h, i) => ({ ...h, score: 0.55 * h.rel + 0.45 * (sem.get(String(i)) ?? 0) }))
              .sort((a, b) => b.score - a.score)
              .slice(0, 8);
            const best = hits[0]?.score ?? 0;
            // The meaning score only reorders the words-based candidates. It cannot make a match more certain than the words say:
            // its scale has not been calibrated against labelled data, so the confidence label stays the lexical one.
            final = { ...lexical, hits: hits.map((h) => ({ ...h, rel: best ? h.score / best : 0 })), mode: "hybrid" };
          } else semanticFailed = true;
        } catch {
          semanticFailed = true; // the words-based result stands, and says so
        }
      }
      if (!mounted.current || seq !== searchSeq.current) return; // closed, or a newer question was asked meanwhile
      setResult({ ...final, topic, readAloud, semanticFailed });
      setPhase("done");
      if (readAloud && final.hits[0] && final.confidence === "high") cb.current.onRead(final.hits[0]);
    },
    [index, serverKey],
  );

  const startServerCapture = useCallback(
    async (mine: number) => {
      const live = () => mounted.current && mine === sessionRef.current;
      const ctl = new AbortController();
      abortRef.current = () => ctl.abort();
      setPhase("starting"); // waiting for the permission prompt; nothing is recording yet
      let rec: Awaited<ReturnType<typeof recordAudio>>;
      try {
        rec = await recordAudio(12000, ctl.signal);
      } catch (e) {
        if (live()) {
          setError(describeMicError(e));
          setPhase("idle");
        }
        return;
      }
      if (!live()) {
        rec.cancel(); // closed or cancelled while the prompt was open: do not record
        return;
      }
      setPhase("listening");
      // Level meter. It is cosmetic: if it cannot be built, recording carries on without it.
      let ctx: AudioContext | null = null;
      try {
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        ctx.createMediaStreamSource(rec.stream).connect(an);
        const buf = new Uint8Array(an.fftSize);
        const tick = () => {
          if (!ctx || !live()) return;
          an.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += Math.abs(v - 128);
          setLevel(Math.min(1, sum / buf.length / 40));
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      } catch {
        ctx = null;
      }
      const closeCtx = () => {
        const c = ctx;
        ctx = null;
        void c?.close().catch(() => {});
      };
      const finish = async (blob: Blob) => {
        closeCtx();
        if (!live()) return;
        setPhase("transcribing");
        let res: Response;
        try {
          const fd = new FormData();
          fd.append("audio", blob); // no language hint: the speaker's language is not the document's, and the model detects it
          const key = getUserKey();
          res = await fetch("/api/speech/transcribe", { method: "POST", headers: key ? { "x-gloss-key": key } : undefined, body: fd });
        } catch {
          if (live()) {
            setError("Could not reach the transcription service. Check your connection and try again.");
            setPhase("idle");
          }
          return;
        }
        const j = (await res.json().catch(() => ({}))) as { text?: string; message?: string };
        if (!live()) return;
        const text = (j.text ?? "").trim();
        if (!res.ok || !text) {
          setError(!res.ok ? j.message || "Transcription failed." : "No speech was heard. Try again, a little closer to the microphone.");
          setPhase("idle");
          return;
        }
        setTranscript(text);
        setDraft(text);
        void search(text);
      };
      stopRef.current = () => {
        stopRef.current = null;
        void rec.stop().then(finish);
      };
      abortRef.current = () => {
        rec.cancel();
        closeCtx();
      };
      // The recorder stops itself after 12 s; make sure the screen follows.
      void rec.done.then((blob) => {
        if (live() && stopRef.current) {
          stopRef.current = null;
          void finish(blob);
        }
      });
    },
    [search],
  );

  const listen = useCallback(async () => {
    abortSession();
    const mine = sessionRef.current;
    const live = () => mounted.current && mine === sessionRef.current;
    setError(null);
    setResult(null);
    setTranscript("");
    setInterim("");
    typedWhileListening.current = false;
    cb.current.onListenStart?.();
    if (supported) {
      setPhase("starting");
      let reported = false;
      let failedOver = false;
      const session = startRecognition(lang, {
        onStart: () => live() && !failedOver && setPhase("listening"),
        onInterim: (t) => {
          if (!live() || failedOver) return;
          setInterim(t);
          if (!typedWhileListening.current) setDraft(t); // never overwrite what the reader is typing
        },
        onFinal: (t) => {
          if (!live() || failedOver) return;
          setTranscript(t);
          setDraft(t);
          setInterim("");
          stopRef.current?.();
          stopRef.current = null;
          void search(t);
        },
        onError: (msg, code) => {
          if (!live() || failedOver) return;
          if (FAILOVER_CODES.has(code) && canServerTranscribe) {
            failedOver = true; // this browser's recogniser cannot help right now: transcribe on the server instead
            abortRef.current?.();
            void startServerCapture(mine);
            return;
          }
          reported = true;
          if (code !== "aborted") setError(msg);
          setPhase("idle");
        },
        onEnd: ({ heard }) => {
          if (!live() || failedOver) return;
          abortRef.current = null;
          stopRef.current = null;
          setPhase((ph) => (ph === "listening" || ph === "starting" ? "idle" : ph));
          if (!heard && !reported) setError("Listening stopped before anything was heard. Tap the microphone to try again.");
        },
      });
      if (!session) {
        if (live()) setPhase("idle");
        return;
      }
      stopRef.current = session.stop;
      abortRef.current = session.abort;
      return;
    }
    if (!canServerTranscribe) {
      setError("This browser has no speech recognition, and server transcription needs a Together AI key. Type your question instead.");
      return;
    }
    await startServerCapture(mine);
  }, [supported, canServerTranscribe, lang, abortSession, search, startServerCapture]);

  // Unmount: nothing keeps listening, and no late result can run.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortSession();
    };
  }, [abortSession]);

  // A hidden page cannot be listened to reliably, and the reader would not know the microphone is on.
  useEffect(() => {
    if (phase !== "listening" && phase !== "starting") return;
    const onHide = () => {
      if (!document.hidden) return;
      abortSession();
      setPhase("idle");
      setError("Listening stopped because the page was hidden. Tap the microphone to try again.");
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [phase, abortSession]);

  // Keyboard: Escape closes; Tab stays inside the dialog. Focus goes to the question on open and back to where it was on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        cb.current.onClose();
      } else if (e.key === "Tab" && dialogRef.current) {
        const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (!dialogRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [open]);

  if (!open) return null;
  const shown = interim || transcript;
  const busy = phase === "starting" || phase === "listening";
  const status =
    phase === "starting"
      ? "Waiting for the microphone"
      : phase === "listening"
        ? "Listening"
        : phase === "transcribing"
          ? "Transcribing"
          : phase === "searching"
            ? "Searching"
            : phase === "done" && result
              ? result.confidence === "none"
                ? "No passage matches"
                : `${Math.min(result.hits.length, 6)} passage${result.hits.length === 1 ? "" : "s"} found${result.confidence === "low" ? ", none is a confident match" : ""}`
              : "";

  return (
    <div className="fixed inset-0 z-[70] grid place-items-start justify-center p-4 pt-[calc(var(--topbar-h)+20px)]">
      <div className="absolute inset-0 bg-[color-mix(in_oklab,var(--bg)_55%,transparent)] backdrop-blur-[3px]" style={{ animation: "fade .25s var(--ease-out)" }} onPointerDown={onClose} />
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="Ask by voice" className="pop relative w-full max-w-[560px] p-5" style={{ ["--origin" as string]: "top center" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-serif text-[21px] leading-tight text-ink">Where does it talk about…</p>
            <p className="mt-1 text-[13px] text-ink-3">Ask aloud, or type. Understand.io searches this text only, and says so when nothing matches.</p>
          </div>
          <button type="button" aria-label="Close" data-tip="Close" data-tip-kbd="Esc" className="grid size-9 place-items-center rounded-full text-ink-3 transition-colors hover:bg-sunk hover:text-ink" onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            aria-pressed={busy}
            aria-label={phase === "starting" ? "Cancel" : phase === "listening" ? "Stop listening" : "Start listening"}
            className={`relative grid size-12 shrink-0 place-items-center rounded-full transition-colors ${busy ? "bg-[var(--rubric)] text-white" : "bg-ink text-bg hover:opacity-90"}`}
            onClick={() => {
              if (phase === "starting") {
                abortSession(); // nothing is recording yet: cancel the request, and release the microphone if it is granted meanwhile
                setPhase("idle");
              } else if (phase === "listening") stopListening();
              else void listen();
            }}
          >
            {busy ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
            {phase === "listening" ? <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-[var(--rubric)] opacity-30 motion-reduce:animate-none" /> : null}
          </button>
          <form
            className="flex min-w-0 flex-1 items-center gap-2 rounded-[14px] border border-rule bg-bg px-3 transition-colors focus-within:border-rule-strong"
            onSubmit={(e) => {
              e.preventDefault();
              const q = draft.trim();
              if (q) {
                abortSession(); // typed words win: drop whatever the recogniser still has in flight
                setPhase("idle");
                setTranscript(q);
                void search(q);
              }
            }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => {
                if (busy) typedWhileListening.current = true;
                setDraft(e.target.value);
              }}
              placeholder={phase === "starting" ? "Waiting for the microphone…" : phase === "listening" ? "Listening…" : phase === "transcribing" ? "Transcribing…" : "Find the part that talks about…"}
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
        <p role="status" aria-live="polite" className="sr-only">
          {status}
        </p>
        {shown && phase !== "done" ? (
          <p className="mt-2 text-[12.5px] text-ink-3">
            Heard: <span className="text-ink">“{shown}”</span>
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-3 rounded-[10px] bg-rubric-wash px-3 py-2 text-[13px] text-rubric-text">
            {error}
          </p>
        ) : null}
        {!supported && phase === "idle" && !error ? (
          <p className="mt-2 text-[12px] text-ink-4">{canServerTranscribe ? "This browser has no built-in speech recognition; your voice is transcribed on the server." : "This browser has no built-in speech recognition. Type your question, or add a Together key for server transcription."}</p>
        ) : null}

        {phase === "searching" ? <div className="loading-bar mt-5" aria-label="Searching" /> : null}

        {result && phase === "done" ? (
          <div className="mt-4">
            <p className="text-[12.5px] text-ink-3">
              {result.confidence === "none" ? (
                <>
                  No passage in this text matches <span className="text-ink">“{result.topic}”</span>. Try other words, or ask about the whole text instead.
                </>
              ) : (
                <>
                  {result.confidence === "low" ? "Possible matches for " : "Matches for "}
                  <span className="text-ink">“{result.topic}”</span>
                  {result.confidence === "low" ? " — none is a confident hit." : ""}
                  <span className="text-ink-4"> · {result.mode === "hybrid" ? "words + meaning" : result.semanticFailed ? "words only (meaning search unavailable)" : "words only"}</span>
                </>
              )}
            </p>
            {result.hits.length ? (
              <ol className="mt-3 space-y-2">
                {result.hits.slice(0, 6).map((h, i) => (
                  <li key={`${h.blockId}:${h.start}`} className="group flex items-start gap-2 rounded-[14px] border border-rule bg-bg px-3.5 py-3 transition-colors hover:border-rule-strong">
                    <span className="mt-0.5 shrink-0 text-[11.5px] tabular-nums text-ink-4">{i + 1}</span>
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        onJump(h);
                        onClose();
                      }}
                    >
                      <span className="flex items-center gap-2 text-[11.5px] text-ink-3">
                        {h.n ? <span className="cite pointer-events-none !m-0 !text-[11px]">¶{h.n}</span> : null}
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-rule">
                          <span className="block h-full rounded-full bg-[var(--rubric)]" style={{ width: `${Math.round(h.rel * 100)}%` }} />
                        </span>
                      </span>
                      <span className="mt-1.5 line-clamp-3 font-serif text-[15px] leading-[1.45] text-ink-2 group-hover:text-ink">{highlightExcerpt(h.excerpt, result.queryTokens, result.lang)}</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Read this passage aloud"
                      data-tip="Read aloud"
                      className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-sunk hover:text-ink"
                      onClick={() => {
                        onRead(h);
                        onClose();
                      }}
                    >
                      <Headphones size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label="Go to this passage"
                      data-tip="Go there"
                      className="grid size-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-sunk hover:text-ink"
                      onClick={() => {
                        onJump(h);
                        onClose();
                      }}
                    >
                      <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
        <p className="mt-4 text-[11.5px] leading-snug text-ink-4">Try: “find the part about the sea floor” · “where does the author explain the main argument” · “encontre a conclusão e leia esse trecho”.</p>
        <p className="mt-2 text-[11.5px] leading-snug text-ink-4">
          {supported ? "Your voice is processed by your browser's speech service (Chrome, Edge and Safari send the audio to their provider)." : canServerTranscribe ? "Your voice is sent to Together AI to be transcribed." : "Voice needs a speech service this browser does not have; typing works everywhere."}
          {hasKey ? " Ranking by meaning sends your question and a few short excerpts of this text to Together AI." : ""}
        </p>
      </section>
    </div>
  );
}

/** Mark the words of an excerpt that match the query, by comparing stems (not by pattern-matching the stem text). */
function highlightExcerpt(text: string, tokens: string[], lang: string) {
  if (!tokens.length) return text;
  const wanted = new Set(tokens);
  return text.split(/(\p{L}[\p{L}\p{N}'’-]*)/u).map((part, i) =>
    i % 2 === 1 && tokenize(part, false, lang).some((t) => wanted.has(t)) ? (
      <span key={i} className="hit-mark">
        {part}
      </span>
    ) : (
      part
    ),
  );
}
