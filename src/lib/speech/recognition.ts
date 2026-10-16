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
  onInterim(text: string): void;
  onFinal(text: string, confidence: number): void;
  onError(message: string, code: string): void;
  onEnd(): void;
}

/** Start browser speech recognition. Returns a stop function, or null when unsupported. */
export function startRecognition(lang: string, h: RecognitionHandlers): (() => void) | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finalText = "";
  rec.onresult = (e) => {
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
  rec.onerror = (e) => h.onError(describeRecognitionError(e.error), e.error);
  rec.onend = () => h.onEnd();
  try {
    rec.start();
  } catch (err) {
    h.onError(String(err), "start-failed");
    return null;
  }
  return () => {
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
  };
}

export function describeRecognitionError(code: string) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied. Allow the microphone for this site and try again.";
    case "no-speech":
      return "No speech was heard. Try again, a little closer to the microphone.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition needs a network connection in this browser.";
    case "aborted":
      return "Listening stopped.";
    default:
      return `Speech recognition failed (${code}).`;
  }
}

/** Record microphone audio to a Blob (for server-side transcription fallback). */
export async function recordAudio(maxMs = 12000): Promise<{ stop: () => Promise<Blob>; stream: MediaStream }> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob>((resolve) => {
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
    };
  });
  rec.start();
  const timer = window.setTimeout(() => rec.state !== "inactive" && rec.stop(), maxMs);
  return {
    stream,
    stop: () => {
      window.clearTimeout(timer);
      if (rec.state !== "inactive") rec.stop();
      return done;
    },
  };
}
