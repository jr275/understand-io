// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "@/lib/content/types";

type Handler = ((e: unknown) => void) | null;
class FakeUtterance {
  text: string;
  rate = 1;
  voice: { voiceURI: string; lang: string } | null = null;
  lang = "";
  onend: Handler = null;
  onerror: Handler = null;
  onboundary: Handler = null;
  constructor(text: string) {
    this.text = text;
  }
}

interface Call {
  text: string;
  rate: number;
  lang: string;
  voice: string | null;
  /** The engine's `paused` flag at the moment speak() was called: a paused engine queues the utterance silently. */
  pausedAtSpeak: boolean;
}

const spoken: string[] = [];
const calls: Call[] = [];
let current: FakeUtterance | null = null;
const opts = { cancelKeepsPaused: false, endOnCancel: false };
const synth = {
  speaking: false,
  paused: false,
  pending: false,
  voices: [] as { voiceURI: string; name: string; lang: string; localService: boolean; default: boolean }[],
  getVoices() {
    return synth.voices;
  },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  speak(u: FakeUtterance) {
    current = u;
    synth.speaking = true;
    spoken.push(u.text);
    calls.push({ text: u.text, rate: u.rate, lang: u.lang, voice: u.voice?.voiceURI ?? null, pausedAtSpeak: synth.paused });
  },
  cancel() {
    const u = current;
    current = null;
    synth.speaking = false;
    if (!opts.cancelKeepsPaused) synth.paused = false; // real Chrome sometimes keeps `paused` after cancel()
    if (opts.endOnCancel && u) u.onend?.({}); // some engines/polyfills fire `end` synchronously inside cancel()
  },
  pause() {
    synth.paused = true;
  },
  resume() {
    synth.paused = false;
  },
};
Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });

const { SpeechController } = await import("@/lib/speech/controller");

const blocks: Block[] = [
  { id: "p1", type: "p", n: 1, text: "One. Two. Three." },
  { id: "p2", type: "p", n: 2, text: "Four. Five." },
];

const tick = (ms = 40) => vi.advanceTimersByTime(ms);
const make = () => {
  const c = new SpeechController();
  c.setBlocks(blocks);
  return c;
};

describe("SpeechController", () => {
  beforeEach(() => {
    spoken.length = 0;
    calls.length = 0;
    current = null;
    opts.cancelKeepsPaused = false;
    opts.endOnCancel = false;
    synth.paused = false;
    synth.voices = [];
    synth.addEventListener.mockClear();
    synth.removeEventListener.mockClear();
    vi.useFakeTimers();
  });

  it("speaks one sentence at a time and advances on end", () => {
    const c = make();
    c.playFrom();
    tick();
    expect(spoken).toEqual(["One."]);
    current!.onend!({});
    tick();
    expect(spoken).toEqual(["One.", "Two."]);
    expect(c.snapshot().index).toBe(1);
  });

  it("skipping while paused drops the queued sentence and resumes at the new one", () => {
    const c = make();
    c.playFrom();
    tick();
    c.pause();
    expect(c.snapshot().state).toBe("paused");
    c.skip(2);
    expect(c.snapshot().index).toBe(2);
    expect(current).toBeNull(); // old utterance cancelled
    c.resume();
    tick();
    expect(spoken.at(-1)).toBe("Three.");
    expect(c.snapshot().state).toBe("playing");
  });

  it("never overlaps sessions: starting again cancels the previous utterance", () => {
    const c = make();
    c.playFrom();
    tick();
    const first = current;
    c.playFrom("p2");
    tick();
    expect(spoken.at(-1)).toBe("Four.");
    first!.onend?.({}); // a late end from the cancelled utterance must not advance anything
    tick();
    expect(spoken.at(-1)).toBe("Four.");
  });

  it("reads a passage, then continues with the rest of the text", () => {
    const c = make();
    c.playRange({ b: "p1", o: 5 }, { b: "p1", o: 9 }, true);
    tick();
    expect(spoken).toEqual(["Two."]);
    expect(c.snapshot().passage).toBe(true);
    current!.onend!({});
    tick();
    expect(spoken.at(-1)).toBe("Three.");
    expect(c.snapshot().passage).toBe(false);
  });

  it("keeps the counter in whole-text terms after a passage and when resuming mid-text", () => {
    const c = make();
    // Whole text has five sentences; the passage is sentence 2 ("Two.").
    c.playRange({ b: "p1", o: 5 }, { b: "p1", o: 9 }, true);
    tick();
    expect(c.snapshot()).toMatchObject({ passage: true, index: 0, total: 1 });
    current!.onend!({});
    tick();
    // Continues with "Three.", which is sentence 3 of 5.
    expect(c.snapshot()).toMatchObject({ passage: false, index: 0, offset: 2, grand: 5 });
    c.stop();
    c.playFrom("p2");
    tick();
    expect(spoken.at(-1)).toBe("Four.");
    expect(c.snapshot()).toMatchObject({ offset: 3, grand: 5, total: 2 });
  });

  it("surfaces a stalled engine through the watchdog and can restart from the error", () => {
    const c = make();
    c.attach();
    c.playFrom();
    tick();
    tick(20000);
    expect(c.snapshot().state).toBe("error");
    c.toggle();
    tick();
    expect(c.snapshot().state).toBe("playing");
    c.dispose();
    expect(synth.removeEventListener).toHaveBeenCalled();
  });

  describe("pause, cancel and the engine's paused flag (TTS-1)", () => {
    it("pause, skip, resume still speaks with an un-paused engine, even if cancel() leaves paused set", () => {
      opts.cancelKeepsPaused = true;
      const c = make();
      c.playFrom();
      tick();
      c.pause();
      c.skip(2);
      c.resume();
      tick();
      expect(spoken.at(-1)).toBe("Three.");
      expect(calls.at(-1)!.pausedAtSpeak).toBe(false);
    });
    it("pause, stop, play again is audible", () => {
      opts.cancelKeepsPaused = true;
      const c = make();
      c.playFrom();
      tick();
      c.pause();
      c.stop();
      c.playFrom("p2");
      tick();
      expect(calls.at(-1)).toMatchObject({ text: "Four.", pausedAtSpeak: false });
    });
    it("pause, then a passage from the selection toolbar is audible", () => {
      opts.cancelKeepsPaused = true;
      const c = make();
      c.playFrom();
      tick();
      c.pause();
      c.playRange({ b: "p1", o: 5 }, { b: "p1", o: 9 }, true);
      tick();
      expect(calls.at(-1)).toMatchObject({ text: "Two.", pausedAtSpeak: false });
    });
  });

  describe("errors and stale callbacks (TTS-2, TTS-15, TTS-23)", () => {
    it("an error invalidates the utterance: a late end must not keep speaking under the error state", () => {
      const c = make();
      c.playFrom();
      tick();
      const u = current!;
      const onend = u.onend;
      u.onerror!({ error: "synthesis-failed" });
      expect(c.snapshot()).toMatchObject({ state: "error", index: 0 });
      onend?.({}); // engines that fire error and then end
      tick();
      expect(spoken).toEqual(["One."]);
      expect(c.snapshot().state).toBe("error");
    });
    it("an interruption of the current utterance by something else is reported, not silently waited out", () => {
      const c = make();
      c.playFrom();
      tick();
      current!.onerror!({ error: "interrupted" });
      expect(c.snapshot().state).toBe("error");
      expect(c.snapshot().error).toMatch(/interrupted/i);
    });
    it("our own cancel never produces an error: the late interrupted event of a replaced utterance is ignored", () => {
      const c = make();
      c.playFrom();
      tick();
      const first = current!;
      const firstOnError = first.onerror;
      c.skip(1);
      tick();
      firstOnError?.({ error: "interrupted" }); // Chrome reports this for the utterance we just cancelled
      expect(c.snapshot().state).toBe("playing");
      expect(spoken.at(-1)).toBe("Two.");
    });
    it("an engine that fires end synchronously inside cancel() cannot clobber a passage", () => {
      opts.endOnCancel = true;
      const c = make();
      c.playFrom("p2");
      tick();
      c.playRange({ b: "p1", o: 0 }, { b: "p1", o: 4 }, true);
      tick();
      expect(spoken.slice(-1)).toEqual(["One."]);
      expect(c.snapshot().passage).toBe(true);
    });
    it("holds a reference to the utterance in flight (so the engine's garbage collector cannot drop its end event)", () => {
      const c = make();
      c.playFrom();
      tick();
      expect((c as unknown as { current: unknown }).current).toBe(current);
    });
  });

  describe("counter and positions (TTS-3, TTS-16, TTS-17)", () => {
    it("the whole-text counter survives an error and a retry", () => {
      const c = make();
      c.playFrom("p2");
      tick();
      expect(c.snapshot()).toMatchObject({ offset: 3, grand: 5, index: 0 });
      current!.onerror!({ error: "synthesis-failed" });
      c.toggle();
      tick();
      expect(c.snapshot()).toMatchObject({ state: "playing", offset: 3, grand: 5, index: 0 });
      expect(spoken.at(-1)).toBe("Four.");
    });
    it("skipping while in the error state keeps the counter", () => {
      const c = make();
      c.playFrom("p2");
      tick();
      current!.onerror!({ error: "synthesis-failed" });
      c.skip(1);
      tick();
      expect(c.snapshot()).toMatchObject({ offset: 3, grand: 5, index: 1 });
    });
    it("restart goes back to the start of the whole text, with a matching counter", () => {
      const c = make();
      c.playFrom("p2");
      tick();
      c.restart();
      tick();
      expect(spoken.at(-1)).toBe("One.");
      expect(c.snapshot()).toMatchObject({ offset: 0, grand: 5, index: 0, total: 5 });
    });
    it("restart inside a passage replays the passage", () => {
      const c = make();
      c.playRange({ b: "p1", o: 5 }, { b: "p1", o: 9 }, true);
      tick();
      c.restart();
      tick();
      expect(spoken.at(-1)).toBe("Two.");
      expect(c.snapshot().passage).toBe(true);
    });
    it("an unknown start block begins at the top instead of doing nothing, and the counter never exceeds the total", () => {
      const c = make();
      c.playFrom("missing");
      tick();
      expect(spoken).toEqual(["One."]);
      const s = c.snapshot();
      expect(s.offset + s.index + 1).toBeLessThanOrEqual(s.grand);
    });
    it("skip crosses the boundary between a passage and the text after it", () => {
      const c = make();
      c.playRange({ b: "p1", o: 5 }, { b: "p1", o: 9 }, true);
      tick();
      expect(c.snapshot()).toMatchObject({ passage: true, atEnd: false });
      c.skip(1);
      tick();
      expect(spoken.at(-1)).toBe("Three.");
      expect(c.snapshot()).toMatchObject({ passage: false, offset: 2, grand: 5, index: 0 });
      c.skip(-1); // and back into the passage
      tick();
      expect(spoken.at(-1)).toBe("Two.");
      expect(c.snapshot().passage).toBe(true);
    });
    it("reports the ends of the queue so the skip buttons can be disabled", () => {
      const c = make();
      c.playFrom();
      tick();
      expect(c.snapshot()).toMatchObject({ atStart: true, atEnd: false });
      c.skip(99);
      tick();
      expect(c.snapshot()).toMatchObject({ atStart: false, atEnd: true });
    });
  });

  describe("rate and voice (TTS-14)", () => {
    it("a rate changed while playing restarts the current sentence at the new rate", () => {
      const c = make();
      c.playFrom();
      tick();
      c.setRate(1.5);
      tick();
      expect(calls.map((x) => `${x.text}@${x.rate}`)).toEqual(["One.@1", "One.@1.5"]);
    });
    it("a rate changed while paused applies when playback resumes", () => {
      const c = make();
      c.playFrom();
      tick();
      c.pause();
      c.setRate(2);
      c.resume();
      tick();
      expect(calls.at(-1)).toMatchObject({ text: "One.", rate: 2, pausedAtSpeak: false });
    });
  });

  describe("long sentences are spoken in chunks", () => {
    const long = "A clause of some length, " + "another clause that keeps going, ".repeat(18) + "and the end.";
    it("one utterance per chunk, each within the limit, one index advance per sentence", () => {
      const c = new SpeechController();
      c.setBlocks([{ id: "p1", type: "p", n: 1, text: `${long} Short one.` }]);
      c.playFrom();
      tick();
      const heard: string[] = [];
      for (let i = 0; i < 20 && current; i++) {
        heard.push(current.text);
        const u = current;
        u.onend!({});
        tick();
        if (c.snapshot().state === "idle") break;
      }
      const sentenceChunks = heard.slice(0, -1);
      expect(sentenceChunks.length).toBeGreaterThan(2);
      for (const h of sentenceChunks) expect(h.length).toBeLessThanOrEqual(220);
      expect(sentenceChunks.join(" ").replace(/\s+/g, " ")).toBe(long.replace(/\s+/g, " "));
      expect(heard.at(-1)).toBe("Short one.");
      expect(c.snapshot().endedBy).toBe("completed");
    });
    it("the counter and the highlighted sentence stay on the sentence while its chunks are read", () => {
      const c = new SpeechController();
      c.setBlocks([{ id: "p1", type: "p", n: 1, text: `${long} Short one.` }]);
      c.playFrom();
      tick();
      current!.onend!({});
      tick();
      expect(c.snapshot()).toMatchObject({ index: 0, total: 2 });
      expect(c.snapshot().segment?.text.startsWith("A clause of some length")).toBe(true);
    });
  });

  describe("how a session ends (TTS-22) and spoken text (TTS-19)", () => {
    it("distinguishes completed from stopped", () => {
      const c = new SpeechController();
      c.setBlocks([{ id: "p1", type: "p", n: 1, text: "Only one." }]);
      expect(c.snapshot().endedBy).toBeNull();
      c.playFrom();
      tick();
      current!.onend!({});
      expect(c.snapshot()).toMatchObject({ state: "idle", endedBy: "completed" });
      c.playFrom();
      tick();
      expect(c.snapshot().endedBy).toBeNull();
      c.stop();
      expect(c.snapshot()).toMatchObject({ state: "idle", endedBy: "stopped" });
    });
    it("footnote markers are not spoken", () => {
      const c = new SpeechController();
      c.setBlocks([{ id: "p1", type: "p", n: 1, text: "It ended.[1] Then more [2] here." }]);
      c.playFrom();
      tick();
      expect(spoken).toEqual(["It ended."]);
      current!.onend!({});
      tick();
      expect(spoken.at(-1)).toBe("Then more here.");
    });
    it("does not listen to word boundaries, so a spoken word never re-renders the reader", () => {
      const c = make();
      c.playFrom();
      tick();
      expect(current!.onboundary).toBeNull();
    });
  });

  describe("language and voice choice (TTS-6)", () => {
    const en = { voiceURI: "en-1", name: "Samantha", lang: "en-US", localService: true, default: true };
    const pt = { voiceURI: "pt-1", name: "Luciana", lang: "pt-BR", localService: true, default: false };
    it("a Portuguese text gets a Portuguese voice even when an English voice was chosen earlier", () => {
      synth.voices = [en, pt];
      const c = make();
      c.setLang("pt-BR");
      c.setVoice("en-1");
      c.playFrom();
      tick();
      expect(calls.at(-1)).toMatchObject({ voice: "pt-1", lang: "pt-BR" });
    });
    it("an English text with no chosen voice leaves the engine's default voice alone", () => {
      synth.voices = [en, pt];
      const c = make();
      c.setLang("en-US");
      c.playFrom();
      tick();
      expect(calls.at(-1)).toMatchObject({ voice: null, lang: "en-US" });
    });
    it("a chosen voice that matches the text's language is honoured", () => {
      synth.voices = [en, { ...en, voiceURI: "en-2", name: "Daniel", lang: "en-GB" }];
      const c = make();
      c.setLang("en-US");
      c.setVoice("en-2");
      c.playFrom();
      tick();
      expect(calls.at(-1)).toMatchObject({ voice: "en-2", lang: "en-GB" });
    });
  });

  describe("lifecycle (TTS-18)", () => {
    it("attach, detach and attach again re-registers the voice listener (React StrictMode mounts twice)", () => {
      const c = make();
      c.attach();
      c.attach(); // idempotent
      expect(synth.addEventListener).toHaveBeenCalledTimes(1);
      c.detach();
      expect(synth.removeEventListener).toHaveBeenCalledTimes(1);
      c.attach();
      expect(synth.addEventListener).toHaveBeenCalledTimes(2);
    });
    it("detach stops what is playing", () => {
      const c = make();
      c.playFrom();
      tick();
      c.detach();
      expect(c.snapshot().state).toBe("idle");
      expect(current).toBeNull();
    });
    it("exposes stable store functions so useSyncExternalStore does not resubscribe on every render", () => {
      const c = make();
      expect(c.store.subscribe).toBe(c.store.subscribe);
      const listener = vi.fn();
      const off = c.store.subscribe(listener);
      c.playFrom();
      expect(listener).toHaveBeenCalled();
      off();
    });
  });
});
