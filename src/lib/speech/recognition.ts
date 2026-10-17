"use client";

/* Minimal typings for the Web Speech recognition API (not in lib.dom for all targets). */
interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string; confidence: number };
}
interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

export function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface RecognitionHandlers {
  /** The engine is really capturing now (after any permission prompt). */
  onStart(): void;
  onInterim(text: string): void;
  onFinal(text: string, confidence: number): void;
  onError(message: string, code: string): void;
  /** The session is over; `heard` is whether it produced any result at all. */
  onEnd(info: { heard: boolean }): void;
}

export interface RecognitionSession {
  /** Stop listening but let the engine deliver what it already heard (a final result may still arrive). */
  stop(): void;
  /** Stop for good: no further callback of this session will run, and a result still in flight is dropped. */
  abort(): void;
}

/** Start browser speech recognition. Returns the session, or null when unsupported or when starting failed (after reporting it). */
export function startRecognition(lang: string, h: RecognitionHandlers): RecognitionSession | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let live = true;
  let heard = false;
  let finalText = "";
  // Once aborted, or after the end event, nothing from this recogniser may reach the caller.
  const detach = () => {
    live = false;
    rec.onresult = rec.onerror = rec.onend = rec.onstart = null;
  };
  rec.onstart = () => live && h.onStart();
  rec.onresult = (e) => {
    if (!live) return;
    heard = true;
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        finalText += r[0].transcript;
        h.onFinal(finalText.trim(), r[0].confidence);
      } else interim += r[0].transcript;
    }
    if (interim) h.onInterim((finalText + interim).trim());
  };
  rec.onerror = (e) => live && h.onError(describeRecognitionError(e.error), e.error);
  rec.onend = () => {
    if (!live) return;
    detach();
    h.onEnd({ heard });
  };
  try {
    rec.start();
  } catch (err) {
    detach();
    h.onError(err instanceof Error && err.name === "InvalidStateError" ? "The microphone is already in use by this page. Try again in a moment." : "Could not start listening.", "start-failed");
    return null;
  }
  return {
    stop() {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
    abort() {
      detach();
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    },
  };
}

export function describeRecognitionError(code: string) {
  switch (code) {
    case "not-allowed":
      return "The microphone was blocked or the permission prompt was dismissed. Allow the microphone for this site (look for the icon in the address bar) and try again.";
    case "service-not-allowed":
      return "Speech recognition is turned off or blocked in this browser. Type your question instead.";
    case "no-speech":
      return "No speech was heard. Try again, a little closer to the microphone.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition needs a network connection in this browser.";
    case "language-not-supported":
      return "This browser cannot recognise speech in this language. Type your question instead.";
    case "aborted":
      return "Listening stopped.";
    default:
      return `Speech recognition failed (${code}).`;
  }
}

/** Error codes after which transcribing the audio on the server is worth trying instead (when it is available). */
export const FAILOVER_CODES = new Set(["network", "service-not-allowed", "language-not-supported"]);

/** A microphone problem that is not one of the browser's own DOMException names. */
export class MicError extends Error {
  constructor(readonly kind: "insecure" | "unsupported") {
    super(kind);
    this.name = "MicError";
  }
}

/** Plain-language message for whatever `getUserMedia` / `MediaRecorder` threw. */
export function describeMicError(e: unknown) {
  // By name, not by class: a DOMException from another realm (an iframe, a test environment) is not `instanceof Error` here.
  const name = typeof (e as { name?: unknown } | null)?.name === "string" ? (e as { name: string }).name : "";
  if (e instanceof MicError) {
    return e.kind === "insecure" ? "The microphone only works on a secure (https) page or on localhost." : "This browser cannot record audio. Type your question instead.";
  }
  if (name === "NotAllowedError" || name === "SecurityError") return "The microphone was blocked or the permission prompt was dismissed. Allow the microphone for this site and try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No microphone was found.";
  if (name === "NotReadableError" || name === "AbortError") return "The microphone is busy in another app or tab.";
  return "Could not start the microphone.";
}

export interface Recording {
  /** Stop recording and resolve with the audio. */
  stop: () => Promise<Blob>;
  /** Stop recording and release the microphone without delivering anything. */
  cancel: () => void;
  stream: MediaStream;
  /** Resolves when the recorder ends by itself (the time cap) or after stop(). */
  done: Promise<Blob>;
}

/**
 * Record microphone audio to a Blob (for server-side transcription). The microphone is always released: on every
 * failure after it was granted, when `signal` aborts (including during the permission prompt), and when the recorder ends.
 */
export async function recordAudio(maxMs = 12000, signal?: AbortSignal): Promise<Recording> {
  if (typeof window !== "undefined" && !window.isSecureContext) throw new MicError("insecure");
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new MicError("unsupported");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const release = () => stream.getTracks().forEach((t) => t.stop());
  try {
    if (signal?.aborted) throw new DOMException("Cancelled while waiting for the microphone", "AbortError");
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        release();
        resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      };
    });
    rec.start();
    const timer = window.setTimeout(() => rec.state !== "inactive" && rec.stop(), maxMs);
    return {
      stream,
      done,
      stop: () => {
        window.clearTimeout(timer);
        if (rec.state !== "inactive") rec.stop();
        else release();
        return done;
      },
      cancel: () => {
        window.clearTimeout(timer);
        if (rec.state !== "inactive") rec.stop();
        release();
      },
    };
  } catch (e) {
    release();
    throw e;
  }
}
