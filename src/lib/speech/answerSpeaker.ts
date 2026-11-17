import { sentences } from "@/lib/search/tokenize";
import { chunkSpeech, spokenText } from "./segments";
import { tNow } from "@/i18n/runtime";

/**
 * Reads one answer aloud with the browser's own voice (the same engine as read-aloud, but for text that is not part of the document:
 * a spoken answer to a question). It never starts by itself except when the caller says so, stops at once on request, and
 * reports whether the engine is speaking, so the screen never shows controls that do nothing.
 */

export type AnswerSpeakerState = "idle" | "speaking" | "error";

/** What a voice should say for an answer: no ¶ citations, no markdown marks. */
export function answerForSpeech(text: string): string {
  return spokenText(
    text
      .replace(/[\[(]?¶\s?\d+[\])]?/g, "")
      .replace(/==/g, "")
      .replace(/\*\*|`/g, "")
      .replace(/(^|\s)\*([^*]+)\*/g, "$1$2")
      .replace(/^\s*[-*•]\s+/gm, "")
      .replace(/\s+([,.;:!?])/g, "$1"),
  );
}

export interface SpeakOptions {
  rate?: number;
  /** `voiceURI` of the voice the reader chose, if any. */
  voiceURI?: string | null;
  /** Language of the text (BCP 47 or ISO 639-1), used to pick a voice when the chosen one speaks another language. */
  lang?: string | null;
}

export class AnswerSpeaker {
  private token = 0;
  private state: AnswerSpeakerState = "idle";
  private listeners = new Set<() => void>();
  private current: SpeechSynthesisUtterance | null = null;
  error: string | null = null;

  static supported() {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
  }

  getState = () => this.state;
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  private set(state: AnswerSpeakerState, error: string | null = null) {
    this.state = state;
    this.error = error;
    this.listeners.forEach((l) => l());
  }

  /** The pieces a voice reads one after the other: sentences, long ones cut at clause breaks. */
  static pieces(text: string): string[] {
    const plain = answerForSpeech(text);
    return sentences(plain).flatMap((s) => chunkSpeech(spokenText(s.text))).filter(Boolean);
  }

  speak(text: string, opts: SpeakOptions = {}): boolean {
    if (!AnswerSpeaker.supported()) {
      this.set("error", tNow("srv.speakUnsupported"));
      return false;
    }
    const queue = AnswerSpeaker.pieces(text);
    if (!queue.length) return false;
    this.stop();
    const my = ++this.token;
    const synth = window.speechSynthesis;
    const voices = synth.getVoices();
    const want = opts.lang?.toLowerCase().split("-")[0];
    const chosen = voices.find((v) => v.voiceURI === opts.voiceURI);
    const voice = want && chosen && !chosen.lang.toLowerCase().startsWith(want) ? voices.find((v) => v.lang.toLowerCase().startsWith(want)) ?? chosen : chosen;
    this.set("speaking");
    let i = 0;
    const next = () => {
      if (my !== this.token) return;
      if (i >= queue.length) {
        this.current = null;
        return this.set("idle");
      }
      const u = new SpeechSynthesisUtterance(queue[i++]);
      u.rate = opts.rate ?? 1;
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else if (opts.lang) u.lang = opts.lang;
      u.onend = () => {
        if (my === this.token) next();
      };
      u.onerror = (e) => {
        if (my !== this.token) return; // our own cancel() reports "interrupted" after the token moved on
        this.current = null;
        this.set("error", e.error === "not-allowed" ? tNow("srv.speakBlocked") : tNow("srv.speakStopped"));
      };
      this.current = u; // held so the engine cannot drop it before it ends
      if (synth.paused) synth.resume();
      synth.speak(u);
    };
    // A short pause after cancel() keeps Chrome from swallowing the first utterance.
    window.setTimeout(next, 30);
    return true;
  }

  stop() {
    this.token++;
    const active = this.state === "speaking" || this.current !== null;
    this.current = null;
    // Only touch the engine when this speaker is using it: read-aloud may own it (paused) and must not be cancelled from here.
    if (active && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      if (window.speechSynthesis.paused) window.speechSynthesis.resume(); // Chrome can keep the paused flag after cancel()
    }
    if (this.state !== "idle") this.set("idle");
  }
}
