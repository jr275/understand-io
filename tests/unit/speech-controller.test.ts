// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "@/lib/content/types";

type Handler = ((e: unknown) => void) | null;
class FakeUtterance {
  text: string;
  rate = 1;
  voice: unknown = null;
  lang = "";
  onend: Handler = null;
  onerror: Handler = null;
  onboundary: Handler = null;
  constructor(text: string) {
    this.text = text;
  }
}
const spoken: string[] = [];
let current: FakeUtterance | null = null;
const synth = {
  speaking: false,
  paused: false,
  pending: false,
  getVoices: () => [],
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  speak(u: FakeUtterance) {
    current = u;
    synth.speaking = true;
    spoken.push(u.text);
  },
  cancel() {
    current = null;
    synth.speaking = false;
    synth.paused = false;
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

describe("SpeechController", () => {
  beforeEach(() => {
    spoken.length = 0;
    current = null;
    vi.useFakeTimers();
  });

  it("speaks one sentence at a time and advances on end", () => {
    const c = new SpeechController();
    c.setBlocks(blocks);
    c.playFrom();
    vi.advanceTimersByTime(40);
    expect(spoken).toEqual(["One."]);
    current!.onend!({});
    vi.advanceTimersByTime(40);
    expect(spoken).toEqual(["One.", "Two."]);
    expect(c.snapshot().index).toBe(1);
  });

  it("skipping while paused drops the queued sentence and resumes at the new one", () => {
    const c = new SpeechController();
    c.setBlocks(blocks);
    c.playFrom();
    vi.advanceTimersByTime(40);
    c.pause();
    expect(c.snapshot().state).toBe("paused");
    c.skip(2);
    expect(c.snapshot().index).toBe(2);
    expect(current).toBeNull(); // old utterance cancelled
    c.resume();
    vi.advanceTimersByTime(40);
    expect(spoken.at(-1)).toBe("Three.");
    expect(c.snapshot().state).toBe("playing");
  });

  it("never overlaps sessions: starting again cancels the previous utterance", () => {
    const c = new SpeechController();
    c.setBlocks(blocks);
    c.playFrom();
    vi.advanceTimersByTime(40);
    const first = current;
    c.playFrom("p2");
    vi.advanceTimersByTime(40);
    expect(spoken.at(-1)).toBe("Four.");
    first!.onend!({}); // a late end from the cancelled utterance must not advance anything
    vi.advanceTimersByTime(40);
    expect(spoken.at(-1)).toBe("Four.");
  });

  it("reads a passage, then continues with the rest of the text", () => {
    const c = new SpeechController();
    c.setBlocks(blocks);
    c.playRange({ b: "p1", o: 5 }, { b: "p1", o: 9 }, true);
    vi.advanceTimersByTime(40);
    expect(spoken).toEqual(["Two."]);
    expect(c.snapshot().passage).toBe(true);
    current!.onend!({});
    vi.advanceTimersByTime(40);
    expect(spoken.at(-1)).toBe("Three.");
    expect(c.snapshot().passage).toBe(false);
  });

  it("surfaces a stalled engine through the watchdog and can restart from the error", () => {
    const c = new SpeechController();
    c.setBlocks(blocks);
    c.playFrom();
    vi.advanceTimersByTime(40);
    vi.advanceTimersByTime(20000);
    expect(c.snapshot().state).toBe("error");
    c.toggle();
    vi.advanceTimersByTime(40);
    expect(c.snapshot().state).toBe("playing");
    c.dispose();
    expect(synth.removeEventListener).toHaveBeenCalled();
  });
});
