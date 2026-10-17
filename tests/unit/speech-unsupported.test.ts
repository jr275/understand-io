// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

// No speechSynthesis in this window: the controller must degrade quietly (Firefox on some platforms, old WebViews).
describe("SpeechController without speechSynthesis", () => {
  it("reports unsupported and every control is a safe no-op", async () => {
    expect("speechSynthesis" in window).toBe(false);
    const { SpeechController } = await import("@/lib/speech/controller");
    const c = new SpeechController();
    c.setBlocks([{ id: "p1", type: "p", n: 1, text: "One. Two." }]);
    expect(c.supported).toBe(false);
    expect(c.snapshot().state).toBe("unsupported");
    expect(() => {
      c.attach();
      c.playFrom();
      c.playFrom("p1");
      c.playRange({ b: "p1", o: 0 }, { b: "p1", o: 4 }, true);
      c.pause();
      c.resume();
      c.toggle();
      c.skip(1);
      c.restart();
      c.setRate(2);
      c.setVoice("x");
      c.stop();
      c.detach();
    }).not.toThrow();
    expect(c.snapshot().state).toBe("unsupported");
  });
});
