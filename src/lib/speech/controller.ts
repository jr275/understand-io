"use client";

import type { Block } from "@/lib/content/types";
import { speechSegments, type SpeechSegment } from "./segments";

export type SpeechState = "idle" | "playing" | "paused" | "unsupported" | "error";

export interface SpeechSnapshot {
  state: SpeechState;
  index: number;
  total: number;
  /** Position of `segs[0]` within the whole text and the whole text's sentence count, for the counter. */
  offset: number;
  grand: number;
  segment: SpeechSegment | null;
  /** Character offset within the current segment (from boundary events, when the engine reports them). */
  charIndex: number;
  rate: number;
  voiceURI: string | null;
  error: string | null;
  /** True while reading only a selected passage; `resumeAfter` tells us where to continue. */
  passage: boolean;
}

type Listener = (s: SpeechSnapshot) => void;

/**
 * Read-aloud controller on top of the Web Speech API.
 * One utterance per sentence keeps long documents reliable (Chrome stops long utterances),
 * gives sentence-level highlighting everywhere, and word-level boundaries where the voice
 * supports `onboundary`. Only one session can play at a time per controller, and `speechSynthesis`
 * is cancelled before every start so sessions never overlap.
 */
export class SpeechController {
  private segs: SpeechSegment[] = [];
  private idx = 0;
  private snap: SpeechSnapshot;
  private listeners = new Set<Listener>();
  private token = 0;
  private resumeAfter: SpeechSegment[] | null = null;
  private resumeIndex = 0;
  private voices: SpeechSynthesisVoice[] = [];
  private blocks: Block[] = [];
  private keepAlive: number | undefined;
  private restartOnResume = false;
  private onVoices = () => {
    this.voices = window.speechSynthesis.getVoices();
    this.emit();
  };

  constructor() {
    const supported = typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
    this.snap = {
      state: supported ? "idle" : "unsupported",
      index: 0,
      total: 0,
      offset: 0,
      grand: 0,
      segment: null,
      charIndex: 0,
      rate: 1,
      voiceURI: null,
      error: null,
      passage: false,
    };
    if (supported) {
      this.voices = window.speechSynthesis.getVoices();
      window.speechSynthesis.addEventListener?.("voiceschanged", this.onVoices);
    }
  }

  get supported() {
    return this.snap.state !== "unsupported";
  }

  getVoices() {
    return this.voices;
  }

  snapshot() {
    return this.snap;
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(patch: Partial<SpeechSnapshot> = {}) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l(this.snap));
  }

  setBlocks(blocks: Block[]) {
    if (blocks !== this.blocks) {
      this.stop();
      this.blocks = blocks;
    }
  }

  setRate(rate: number) {
    const r = Math.min(3, Math.max(0.5, rate));
    const wasPlaying = this.snap.state === "playing";
    this.emit({ rate: r });
    if (wasPlaying) this.speakCurrent(); // restart the current sentence at the new rate
  }

  setVoice(voiceURI: string | null) {
    const wasPlaying = this.snap.state === "playing";
    this.emit({ voiceURI });
    if (wasPlaying) this.speakCurrent();
  }

  /** Read the whole text from a block (and optional offset). */
  playFrom(blockId?: string, offset = 0) {
    if (!this.supported) return;
    const from = blockId ? { b: blockId, o: offset } : undefined;
    this.segs = speechSegments(this.blocks, from);
    this.resumeAfter = null;
    this.resumeOffset = from ? this.positionOf(from) : null;
    this.start(0, false);
  }

  /** Read one passage, then (if `resume`) continue with the rest of the text. */
  playRange(start: { b: string; o: number }, end: { b: string; o: number }, resume = false) {
    if (!this.supported) return;
    const passage = speechSegments(this.blocks, start, end);
    if (!passage.length) return;
    if (resume) {
      this.resumeAfter = speechSegments(this.blocks, end);
      this.resumeIndex = 0;
      // Counter continues from the passage's place in the whole text instead of restarting at 1.
      this.resumeOffset = this.positionOf(end);
    } else this.resumeAfter = null;
    this.segs = passage;
    this.start(0, true);
  }

  private resumeOffset: { offset: number; grand: number } | null = null;

  /** Index, within the whole text's sentences, of the first sentence that reaches past `at`. */
  private positionOf(at: { b: string; o: number }) {
    const whole = speechSegments(this.blocks);
    const order = new Map(this.blocks.map((b, i) => [b.id, i]));
    const atOrder = order.get(at.b) ?? Infinity;
    let base = whole.findIndex((s) => (order.get(s.blockId) ?? 0) > atOrder || (s.blockId === at.b && s.end > at.o));
    if (base < 0) base = whole.length;
    return { offset: base, grand: whole.length };
  }

  private start(index: number, passage: boolean) {
    window.speechSynthesis.cancel();
    this.idx = index;
    const pos = !passage && this.resumeOffset ? this.resumeOffset : { offset: 0, grand: this.segs.length };
    if (!passage) this.resumeOffset = null;
    this.emit({ state: "playing", index, total: this.segs.length, offset: pos.offset, grand: pos.grand, segment: this.segs[index] ?? null, charIndex: 0, error: null, passage });
    this.speakCurrent();
  }

  private speakCurrent() {
    const seg = this.segs[this.idx];
    if (!seg) return this.finish();
    const myToken = ++this.token;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(seg.text);
    u.rate = this.snap.rate;
    const v = this.voices.find((x) => x.voiceURI === this.snap.voiceURI);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    u.onboundary = (e) => {
      if (myToken !== this.token) return;
      if (e.name === "word") this.emit({ charIndex: e.charIndex });
    };
    u.onend = () => {
      if (myToken !== this.token) return;
      this.next();
    };
    u.onerror = (e) => {
      if (myToken !== this.token) return;
      if (e.error === "interrupted" || e.error === "canceled") return;
      this.clearKeepAlive();
      this.emit({ state: "error", error: describeError(e.error) });
    };
    this.emit({ index: this.idx, segment: seg, charIndex: 0 });
    // Small delay after cancel() avoids Chrome swallowing the first utterance.
    window.setTimeout(() => {
      if (myToken !== this.token) return;
      window.speechSynthesis.speak(u);
      this.armKeepAlive();
      this.armWatchdog(myToken, seg.text);
    }, 30);
  }

  /** Engines sometimes never fire `end` (muted output, broken voice). Surface that instead of hanging. */
  private armWatchdog(token: number, text: string) {
    window.clearTimeout(this.watchdog);
    const words = text.split(/\s+/).length;
    const budget = (words * 700) / Math.max(0.5, this.snap.rate) + 8000;
    this.watchdog = window.setTimeout(() => {
      if (token !== this.token || this.snap.state !== "playing") return;
      this.clearKeepAlive();
      window.speechSynthesis.cancel();
      this.token++;
      this.emit({ state: "error", error: "The speech engine did not finish this sentence. Try another voice, or check that audio is not muted." });
    }, budget);
  }
  private watchdog: number | undefined;

  /** Chrome pauses long sessions after ~15s of continuous speech unless nudged. */
  private armKeepAlive() {
    this.clearKeepAlive();
    this.keepAlive = window.setInterval(() => {
      if (this.snap.state !== "playing") return;
      if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);
  }

  private clearKeepAlive() {
    if (this.keepAlive) window.clearInterval(this.keepAlive);
    this.keepAlive = undefined;
    window.clearTimeout(this.watchdog);
  }

  private next() {
    if (this.idx + 1 < this.segs.length) {
      this.idx += 1;
      this.speakCurrent();
    } else if (this.resumeAfter?.length) {
      this.segs = this.resumeAfter;
      this.resumeAfter = null;
      this.start(this.resumeIndex, false);
    } else this.finish();
  }

  private finish() {
    this.clearKeepAlive();
    this.token++;
    this.emit({ state: "idle", segment: null, charIndex: 0, passage: false });
  }

  pause() {
    if (this.snap.state !== "playing") return;
    window.clearTimeout(this.watchdog);
    window.speechSynthesis.pause();
    this.emit({ state: "paused" });
  }

  resume() {
    if (this.snap.state !== "paused") return;
    // Some engines cannot resume reliably; restart the current sentence instead.
    this.emit({ state: "playing" });
    if (this.restartOnResume) {
      this.restartOnResume = false;
      this.speakCurrent();
      return;
    }
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      const seg = this.segs[this.idx];
      if (seg) this.armWatchdog(this.token, seg.text);
    } else this.speakCurrent();
  }

  toggle() {
    if (this.snap.state === "playing") this.pause();
    else if (this.snap.state === "paused") this.resume();
    else if (this.snap.state === "error" && this.segs.length) this.start(this.idx, this.snap.passage);
  }

  stop() {
    if (!this.supported) return;
    this.restartOnResume = false;
    this.token++;
    this.clearKeepAlive();
    window.speechSynthesis.cancel();
    this.resumeAfter = null;
    this.emit({ state: "idle", segment: null, charIndex: 0, passage: false });
  }

  restart() {
    if (!this.segs.length) return;
    this.start(0, this.snap.passage);
  }

  /** Move to another sentence. While paused, the queued utterance is dropped so resume starts the new one. */
  private goTo(i: number) {
    this.idx = i;
    if (this.snap.state === "paused") {
      this.token++;
      window.speechSynthesis.cancel();
      this.restartOnResume = true;
      this.emit({ index: i, segment: this.segs[i], charIndex: 0 });
    } else if (this.snap.state === "playing") {
      this.speakCurrent();
    } else {
      this.start(i, this.snap.passage);
    }
  }

  skip(delta: number) {
    if (!this.segs.length) return;
    this.goTo(Math.min(this.segs.length - 1, Math.max(0, this.idx + delta)));
  }

  /** Jump to a sentence that contains the given block offset (used when the user clicks a paragraph). */
  seekTo(blockId: string, offset = 0) {
    const i = this.segs.findIndex((s) => s.blockId === blockId && s.end > offset);
    if (i >= 0) {
      this.goTo(i);
      return true;
    }
    return false;
  }

  dispose() {
    this.stop();
    this.listeners.clear();
    if (this.supported) window.speechSynthesis.removeEventListener?.("voiceschanged", this.onVoices);
  }
}

function describeError(code: string) {
  switch (code) {
    case "not-allowed":
      return "The browser blocked speech. Click the page once, then try again.";
    case "network":
      return "This voice needs a network connection.";
    case "synthesis-unavailable":
    case "synthesis-failed":
      return "The speech engine failed. Try another voice.";
    case "audio-busy":
      return "Audio is busy in another app.";
    default:
      return `Speech stopped (${code}).`;
  }
}
