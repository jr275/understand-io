// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerSpeaker, answerForSpeech } from "@/lib/speech/answerSpeaker";

type Handler = ((e: unknown) => void) | null;
class FakeUtterance {
  text: string;
  rate = 1;
  voice: { voiceURI: string; lang: string } | null = null;
  lang = "";
  onend: Handler = null;
  onerror: Handler = null;
  constructor(text: string) {
    this.text = text;
  }
}
const spoken: { text: string; rate: number; lang: string; voice: string | null; paused: boolean }[] = [];
let current: FakeUtterance | null = null;
const synth = {
  paused: false,
  voices: [
    { voiceURI: "en-1", name: "En", lang: "en-US", localService: true, default: true },
    { voiceURI: "pt-1", name: "Pt", lang: "pt-BR", localService: true, default: false },
  ],
  getVoices: () => synth.voices,
  speak(u: FakeUtterance) {
    current = u;
    spoken.push({ text: u.text, rate: u.rate, lang: u.lang, voice: u.voice?.voiceURI ?? null, paused: synth.paused });
  },
  cancel() {
    current = null; // like real Chrome: the paused flag survives a cancel
  },
  resume() {
    synth.paused = false;
  },
};
const finish = () => current?.onend?.({});

beforeEach(() => {
  vi.useFakeTimers();
  spoken.length = 0;
  current = null;
  synth.paused = false;
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("answerForSpeech", () => {
  it("drops ¶ citations and markdown marks and keeps the words", () => {
    expect(answerForSpeech("==The tide rises== (¶3) when the **moon** passes ¶ 12, see [¶4].")).toBe("The tide rises when the moon passes, see .".replace(" .", "."));
    expect(answerForSpeech("- one ¶2\n- two")).toBe("one two");
  });
  it("keeps the model's labels, which tell the listener where the words come from", () => {
    expect(answerForSpeech("My reading: it means more ¶1.")).toBe("My reading: it means more.");
  });
});

describe("AnswerSpeaker", () => {
  it("reads sentence by sentence, in order, with the chosen rate", () => {
    const s = new AnswerSpeaker();
    expect(s.speak("First sentence is here. Second sentence follows ¶2. Third one.", { rate: 1.5 })).toBe(true);
    expect(s.getState()).toBe("speaking");
    vi.advanceTimersByTime(40);
    expect(spoken.map((x) => x.text)).toEqual(["First sentence is here."]);
    finish();
    vi.advanceTimersByTime(40);
    finish();
    vi.advanceTimersByTime(40);
    expect(spoken.map((x) => x.text)).toEqual(["First sentence is here.", "Second sentence follows.", "Third one."]);
    expect(spoken.every((x) => x.rate === 1.5)).toBe(true);
    finish();
    expect(s.getState()).toBe("idle");
  });

  it("stop() ends it at once, and a late end event does not continue", () => {
    const s = new AnswerSpeaker();
    s.speak("One. Two. Three.");
    vi.advanceTimersByTime(40);
    const late = current;
    s.stop();
    expect(s.getState()).toBe("idle");
    late?.onend?.({});
    vi.advanceTimersByTime(100);
    expect(spoken).toHaveLength(1);
  });

  it("speaking again replaces what was being said", () => {
    const s = new AnswerSpeaker();
    s.speak("Old answer one. Old answer two.");
    vi.advanceTimersByTime(40);
    s.speak("New answer.");
    vi.advanceTimersByTime(40);
    expect(spoken.map((x) => x.text)).toEqual(["Old answer one.", "New answer."]);
  });

  it("clears a paused flag Chrome kept after cancel, so the answer is not queued silently", () => {
    const s = new AnswerSpeaker();
    synth.paused = true;
    s.speak("Anything at all.");
    vi.advanceTimersByTime(40);
    expect(spoken[0].paused).toBe(false);
  });

  it("uses a voice of the text's language when the chosen voice speaks another", () => {
    const s = new AnswerSpeaker();
    s.speak("Uma resposta curta.", { voiceURI: "en-1", lang: "pt" });
    vi.advanceTimersByTime(40);
    expect(spoken[0]).toMatchObject({ voice: "pt-1", lang: "pt-BR" });
  });

  it("reports an engine error instead of staying silent, and says nothing for empty text", () => {
    const s = new AnswerSpeaker();
    s.speak("Will fail.");
    vi.advanceTimersByTime(40);
    current?.onerror?.({ error: "synthesis-failed" });
    expect(s.getState()).toBe("error");
    expect(s.error).toMatch(/error/);
    expect(s.speak("   ")).toBe(false);
  });

  it("says so when the browser has no speech engine", () => {
    // @ts-expect-error simulating a browser without speech synthesis
    delete window.speechSynthesis;
    vi.stubGlobal("SpeechSynthesisUtterance", undefined);
    const s = new AnswerSpeaker();
    expect(s.speak("Hello there.")).toBe(false);
    expect(s.getState()).toBe("error");
  });
});
