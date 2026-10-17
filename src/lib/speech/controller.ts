"use client";

import type { Block } from "@/lib/content/types";
import { speechSegments, type SpeechSegment } from "./segments";

export type SpeechState = "idle" | "playing" | "paused" | "unsupported" | "error";

export interface SpeechSnapshot {
  state: SpeechState;
  /** Position inside the current list: the passage while `passage` is true, otherwise the rest of the text. */
  index: number;
  total: number;
  /** Position of the first sentence of the rest of the text within the whole text, and the whole text's sentence count, for the counter. */
  offset: number;
  grand: number;
  segment: SpeechSegment | null;
  rate: number;
  voiceURI: string | null;
  error: string | null;
  /** True while reading only a selected passage (the rest of the text may follow). */
  passage: boolean;
  /** How the last session ended; null while one is running or before any. */
  endedBy: "completed" | "stopped" | null;
  /** First / last sentence of everything queued (passage plus continuation), for disabling skip buttons. */
  atStart: boolean;
  atEnd: boolean;
}

type Listener = (s: SpeechSnapshot) => void;

/**
 * Read-aloud controller on top of the Web Speech API.
 *
 * - One utterance per sentence (long sentences are cut into chunks of at most ~220 characters), because voices
 *   stop or stall on long utterances; the highlight stays on the sentence.
 * - Everything queued (a selected passage and the text that follows it) is one list, so skipping, the counter and
 *   restart behave the same across the boundary.
 * - Every path that supersedes an utterance first invalidates its callbacks (token) and detaches its handlers,
 *   then cancels the engine and un-pauses it (Chrome can keep `paused` after `cancel()`, which would silence the next utterance).
 * - Highlighting is sentence-level; word boundaries are not used.
 */
export class SpeechController {
  private segs: SpeechSegment[] = [];
  private idx = 0;
  private chunkIdx = 0;
  /** Segments [0, passageLen) are the selected passage; the rest is the continuation. */
  private passageLen = 0;
  /** Whole-text position of segs[passageLen], and the whole text's sentence count. */
  private contBase = 0;
  private grand = 0;
  private snap: SpeechSnapshot;
  private listeners = new Set<Listener>();
  private token = 0;
  private current: SpeechSynthesisUtterance | null = null; // referenced so the engine's GC cannot drop `end`
  private voices: SpeechSynthesisVoice[] = [];
  private blocks: Block[] = [];
  private lang: string | null = null;
  private keepAlive: number | undefined;
  private watchdog: number | undefined;
  private restartOnResume = false;
  /** An utterance that was due to be spoken while the reader had paused: it speaks when they resume. */
  private deferred: (() => void) | null = null;
  private attached = false;
  private onVoices = () => {
    this.voices = window.speechSynthesis.getVoices();
    this.emit();
  };
  private onHide = () => {
    if (this.snap.state === "playing" || this.snap.state === "paused") this.stop();
  };

  /** Stable functions for `useSyncExternalStore`. */
  readonly store = {
    subscribe: (cb: () => void) => this.subscribe(() => cb()),
    getSnapshot: () => this.snap,
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
      rate: 1,
      voiceURI: null,
      error: null,
      passage: false,
      endedBy: null,
      atStart: true,
      atEnd: true,
    };
    if (supported) this.voices = window.speechSynthesis.getVoices();
  }

  get supported() {
    return this.snap.state !== "unsupported";
  }

  /** Start listening for voice-list changes and page hide. Safe to call repeatedly, and again after `detach()` (React StrictMode mounts twice). */
  attach() {
    if (!this.supported || this.attached) return;
    this.attached = true;
    this.voices = window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", this.onVoices);
    window.addEventListener("pagehide", this.onHide);
    this.emit();
  }

  /** Stop speaking and remove the listeners added by `attach()`. */
  detach() {
    this.stop();
    if (this.supported && this.attached) {
      window.speechSynthesis.removeEventListener?.("voiceschanged", this.onVoices);
      window.removeEventListener("pagehide", this.onHide);
    }
    this.attached = false;
  }

  /** Alias of `detach()`. */
  dispose() {
    this.detach();
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

  /** Position fields derived from the current index. */
  private position() {
    const inPassage = this.idx < this.passageLen;
    return inPassage
      ? { passage: true, index: this.idx, total: this.passageLen, offset: 0, grand: this.passageLen, atStart: this.idx === 0, atEnd: this.idx >= this.segs.length - 1 }
      : { passage: false, index: this.idx - this.passageLen, total: this.segs.length - this.passageLen, offset: this.contBase, grand: this.grand, atStart: this.idx === 0, atEnd: this.idx >= this.segs.length - 1 };
  }

  setBlocks(blocks: Block[]) {
    if (blocks === this.blocks) return;
    if (this.snap.state === "playing" || this.snap.state === "paused" || this.snap.state === "error") this.stop();
    this.blocks = blocks;
  }

  /** Language of the text (BCP 47). Used to choose a matching voice when the selected one is for another language. */
  setLang(lang: string | null) {
    this.lang = lang;
  }

  setRate(rate: number) {
    this.emit({ rate: Math.min(3, Math.max(0.5, rate)) });
    this.reapply();
  }

  setVoice(voiceURI: string | null) {
    this.emit({ voiceURI });
    this.reapply();
  }

  /** Apply a changed rate or voice to what is playing now (the current chunk restarts), or to what resumes next. */
  private reapply() {
    if (this.snap.state === "playing") this.speakChunk();
    else if (this.snap.state === "paused") {
      this.invalidate();
      this.restartOnResume = true;
    }
  }

  /** Read the whole text from a block (and optional offset). An unknown block starts from the top instead of doing nothing. */
  playFrom(blockId?: string, offset = 0) {
    if (!this.supported) return;
    let from = blockId ? { b: blockId, o: offset } : undefined;
    let segs = speechSegments(this.blocks, from);
    if (!segs.length && from) {
      from = undefined;
      segs = speechSegments(this.blocks);
    }
    if (!segs.length) return;
    const pos = from ? this.positionOf(from) : { offset: 0, grand: segs.length };
    this.segs = segs;
    this.passageLen = 0;
    this.contBase = pos.offset;
    this.grand = pos.grand;
    this.start(0);
  }

  /** Read one passage, then (if `resume`) continue with the rest of the text. */
  playRange(start: { b: string; o: number }, end: { b: string; o: number }, resume = false) {
    if (!this.supported) return;
    const passage = speechSegments(this.blocks, start, end);
    if (!passage.length) return;
    if (resume) {
      const pos = this.positionOf(end); // the counter continues from the passage's place in the whole text
      this.segs = passage.concat(speechSegments(this.blocks, end));
      this.contBase = pos.offset;
      this.grand = pos.grand;
    } else {
      this.segs = passage;
      this.contBase = 0;
      this.grand = passage.length;
    }
    this.passageLen = passage.length;
    this.start(0);
  }

  /** Index, within the whole text's sentences, of the first sentence that reaches past `at`. */
  private positionOf(at: { b: string; o: number }) {
    const whole = speechSegments(this.blocks);
    const order = new Map(this.blocks.map((b, i) => [b.id, i]));
    const atOrder = order.get(at.b) ?? Infinity;
    let base = whole.findIndex((s) => (order.get(s.blockId) ?? 0) > atOrder || (s.blockId === at.b && s.end > at.o));
    if (base < 0) base = Math.max(0, whole.length - 1);
    return { offset: base, grand: whole.length };
  }

  /** Invalidate every callback of the utterance in flight, detach its handlers and clear the engine, including a stuck `paused` flag. */
  private invalidate() {
    this.token++;
    if (this.current) {
      this.current.onend = null;
      this.current.onerror = null;
      this.current.onboundary = null;
      this.current = null;
    }
    this.deferred = null;
    window.clearTimeout(this.watchdog);
    this.hardCancel();
  }

  private hardCancel() {
    const synth = window.speechSynthesis;
    synth.cancel();
    if (synth.paused) synth.resume(); // an empty queue ignores this; a stuck flag would otherwise queue the next utterance silently
  }

  private start(index: number) {
    this.invalidate();
    this.clearKeepAlive();
    this.restartOnResume = false;
    this.idx = index;
    this.chunkIdx = 0;
    this.emit({ state: "playing", segment: this.segs[index] ?? null, error: null, endedBy: null, ...this.position() });
    this.speakChunk();
  }

  private pickVoice() {
    const chosen = this.voices.find((x) => x.voiceURI === this.snap.voiceURI);
    const want = this.lang?.toLowerCase().split("-")[0];
    const pageLang = (typeof document !== "undefined" ? document.documentElement.lang || "en" : "en").toLowerCase().split("-")[0];
    if (!want) return chosen;
    if (chosen && chosen.lang.toLowerCase().startsWith(want)) return chosen;
    if (want === pageLang && !chosen) return undefined; // the engine's default voice already speaks the page language
    const matching = this.voices.filter((v) => v.lang.toLowerCase().startsWith(want));
    return matching.find((v) => v.default) ?? matching.find((v) => v.localService) ?? matching[0] ?? chosen;
  }

  private speakChunk() {
    const seg = this.segs[this.idx];
    if (!seg) return this.finish();
    this.invalidate();
    const myToken = this.token;
    const text = seg.chunks[this.chunkIdx] ?? seg.spoken;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = this.snap.rate;
    const v = this.pickVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else if (this.lang) u.lang = this.lang;
    u.onend = () => {
      if (myToken !== this.token) return;
      this.afterChunk();
    };
    u.onerror = (e) => {
      if (myToken !== this.token) return; // our own cancel() reports "interrupted"/"canceled" after the token moved on
      this.fail(describeError(e.error));
    };
    this.current = u;
    // Small delay after cancel() avoids Chrome swallowing the first utterance.
    window.setTimeout(() => {
      if (myToken !== this.token) return;
      const speak = () => {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume(); // a flag left over from an earlier pause would silence it
        window.speechSynthesis.speak(u);
        this.armKeepAlive();
        this.armWatchdog(myToken, text);
      };
      if (this.snap.state === "paused") this.deferred = speak; // paused during the short delay: say it on resume, not now
      else speak();
    }, 30);
  }

  private afterChunk() {
    const seg = this.segs[this.idx];
    if (seg && this.chunkIdx + 1 < seg.chunks.length) {
      this.chunkIdx += 1;
      this.speakChunk();
    } else this.next();
  }

  private next() {
    if (this.idx + 1 < this.segs.length) {
      this.idx += 1;
      this.chunkIdx = 0;
      this.emit({ segment: this.segs[this.idx], ...this.position() });
      this.speakChunk();
    } else this.finish();
  }

  private fail(message: string) {
    this.invalidate();
    this.clearKeepAlive();
    this.emit({ state: "error", error: message });
  }

  /** Engines sometimes never fire `end` (muted output, broken voice). Surface that instead of hanging. */
  private armWatchdog(token: number, text: string) {
    window.clearTimeout(this.watchdog);
    const words = text.split(/\s+/).length;
    const budget = (words * 700) / Math.max(0.5, this.snap.rate) + 8000;
    this.watchdog = window.setTimeout(() => {
      if (token !== this.token || this.snap.state !== "playing") return;
      this.fail("The speech engine did not finish this sentence. Try another voice, or check that audio is not muted.");
    }, budget);
  }

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

  private finish() {
    this.clearKeepAlive();
    this.invalidate();
    this.emit({ state: "idle", segment: null, passage: false, endedBy: "completed" });
  }

  pause() {
    if (this.snap.state !== "playing") return;
    window.clearTimeout(this.watchdog);
    window.speechSynthesis.pause();
    this.emit({ state: "paused" });
  }

  resume() {
    if (this.snap.state !== "paused") return;
    this.emit({ state: "playing" });
    if (this.deferred) {
      const speak = this.deferred;
      this.deferred = null;
      speak();
      return;
    }
    if (this.restartOnResume) {
      this.restartOnResume = false;
      this.speakChunk();
      return;
    }
    // Some engines cannot resume reliably; restart the current chunk instead.
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      const seg = this.segs[this.idx];
      if (seg) this.armWatchdog(this.token, seg.chunks[this.chunkIdx] ?? seg.spoken);
    } else this.speakChunk();
  }

  toggle() {
    if (this.snap.state === "playing") this.pause();
    else if (this.snap.state === "paused") this.resume();
    else if (this.snap.state === "error" && this.segs.length) this.start(this.idx); // retry the sentence that failed
  }

  stop() {
    if (!this.supported) return;
    const wasActive = this.snap.state !== "idle";
    this.restartOnResume = false;
    this.clearKeepAlive();
    this.invalidate();
    this.emit({ state: "idle", segment: null, passage: false, endedBy: wasActive ? "stopped" : this.snap.endedBy });
  }

  /** Back to the start: of the passage while one is playing, otherwise of the whole text. */
  restart() {
    if (!this.supported || !this.segs.length) return;
    if (this.idx >= this.passageLen) {
      const whole = speechSegments(this.blocks);
      if (whole.length) {
        this.segs = whole;
        this.passageLen = 0;
        this.contBase = 0;
        this.grand = whole.length;
      }
    }
    this.start(0);
  }

  /** Move to another sentence. While paused, the queued utterance is dropped so resume starts the new one. */
  private goTo(i: number) {
    this.idx = i;
    this.chunkIdx = 0;
    if (this.snap.state === "paused") {
      this.invalidate();
      this.restartOnResume = true;
      this.emit({ segment: this.segs[i], ...this.position() });
    } else if (this.snap.state === "playing") {
      this.emit({ segment: this.segs[i], ...this.position() });
      this.speakChunk();
    } else {
      this.start(i);
    }
  }

  /** Skip sentences; works across the boundary between a selected passage and the text after it. */
  skip(delta: number) {
    if (!this.segs.length) return;
    this.goTo(Math.min(this.segs.length - 1, Math.max(0, this.idx + delta)));
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
    case "interrupted":
    case "canceled":
      return "Audio was interrupted by another tab or app.";
    default:
      return `Speech stopped (${code}).`;
  }
}
