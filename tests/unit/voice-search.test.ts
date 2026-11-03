// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chalk from "@/content/samples/on-a-piece-of-chalk.json";
import type { Block } from "@/lib/content/types";
import { VoiceSearch } from "@/components/reader/VoiceSearch";
import { I18nProvider } from "@/i18n/client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/" }));

/*
 * Lifecycle tests for the voice panel with fake browser speech and media APIs (no real microphone, no network).
 * The fakes follow the documented contracts: SpeechRecognition.stop() flushes the pending final result and then fires `end`;
 * abort() drops it; only MediaStreamTrack.stop() releases the microphone. Each test names the review finding it guards.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const blocks = (chalk as { blocks: Block[] }).blocks;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flush = (ms = 15) => act(async () => void (await sleep(ms)));

class FakeRec {
  static instances: FakeRec[] = [];
  /** When false the test decides when capture "really starts" (after the permission prompt). */
  static autoStart = true;
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  stopCalls = 0;
  abortCalls = 0;
  ended = false;
  pendingFinal: string | null = null;
  start() {
    FakeRec.instances.push(this);
    if (FakeRec.autoStart) setTimeout(() => this.onstart?.(), 0);
  }
  stop() {
    this.stopCalls++;
    setTimeout(() => {
      if (this.ended) return;
      if (this.pendingFinal !== null) this.final(this.pendingFinal);
      this.end();
    }, 5);
  }
  abort() {
    this.abortCalls++;
  }
  final(text: string) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal: true })] });
  }
  interim(text: string) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: 0.5 }], { isFinal: false })] });
  }
  end() {
    this.ended = true;
    this.onend?.();
  }
}

class FakeTrack {
  stopCalls = 0;
  stop() {
    this.stopCalls++;
  }
}
class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}
const recorders: FakeMR[] = [];
class FakeMR {
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: FakeStream) {
    recorders.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    setTimeout(() => this.onstop?.(), 2);
  }
}
class FakeAC {
  createMediaStreamSource() {
    return { connect() {} };
  }
  createAnalyser() {
    return { fftSize: 32, getByteTimeDomainData: (b: Uint8Array) => b.fill(128) };
  }
  close() {
    return Promise.resolve();
  }
}

let root: Root;
let host: HTMLElement;
const calls = { read: 0, jump: 0, close: 0, listenStart: 0 };
let rerender: () => Promise<void> = async () => {};
const fetchLog: { url: string }[] = [];
const win = window as unknown as Record<string, unknown>;

async function mount(props: Record<string, unknown> = {}) {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  function App() {
    const [tick, setTick] = useState(0);
    rerender = () => act(async () => setTick((t) => t + 1));
    // Same shape as Reader.tsx: inline callbacks with a new identity on every parent render.
    return createElement(I18nProvider, { locale: "en" }, createElement(VoiceSearch, {
      open: true,
      onClose: () => void calls.close++,
      blocks,
      lang: "en-US",
      onJump: () => void calls.jump++,
      onRead: () => void calls.read++,
      onListenStart: () => void calls.listenStart++,
      serverKey: false,
      ...props,
      "data-tick": tick,
    } as never));
  }
  await act(async () => root.render(createElement(App)));
}
const unmount = () => act(async () => root.unmount());
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());
const mic = () => document.querySelector<HTMLButtonElement>('button[aria-label="Start listening"], button[aria-label="Stop listening"], button[aria-label="Cancel"]')!;
const input = () => document.querySelector<HTMLInputElement>('input[aria-label="What to look for"]')!;
const type = (text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
const submit = () => act(async () => void document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const panel = () => document.querySelector("section")?.textContent ?? "";
const topic = () => /(?:Matches|Possible matches) for\s*“([^”]*)”|No passage in this text matches\s*“([^”]*)”/.exec(panel());
const shownTopic = () => topic()?.[1] ?? topic()?.[2];
const alertText = () => document.querySelector('[role="alert"]')?.textContent ?? null;

beforeEach(() => {
  FakeRec.instances.length = 0;
  FakeRec.autoStart = true;
  recorders.length = 0;
  fetchLog.length = 0;
  Object.assign(calls, { read: 0, jump: 0, close: 0, listenStart: 0 });
  win.SpeechRecognition = FakeRec;
  win.MediaRecorder = FakeMR;
  win.AudioContext = FakeAC;
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  window.localStorage.clear();
  vi.stubGlobal("fetch", async (url: string) => {
    fetchLog.push({ url: String(url) });
    return new Response(JSON.stringify({}), { status: 500 });
  });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  delete win.SpeechRecognition;
  delete win.MediaRecorder;
  delete win.AudioContext;
});

describe("browser speech recognition", () => {
  it("VOICE-1: a re-render of the parent (new onClose each time) does not stop the recogniser", async () => {
    await mount();
    await click(mic());
    const r = FakeRec.instances[0];
    await flush();
    expect(mic().getAttribute("aria-label")).toBe("Stop listening");
    await rerender();
    await rerender();
    await flush();
    expect(r.stopCalls).toBe(0);
    expect(r.abortCalls).toBe(0);
    expect(mic().getAttribute("aria-label")).toBe("Stop listening");
  });

  it("VOICE-2: a result that arrives after the panel closed does nothing (no search, no read-aloud, no network)", async () => {
    await mount({ serverKey: true });
    await click(mic());
    const r = FakeRec.instances[0];
    r.pendingFinal = "find the part about Terebratulina and read it";
    await unmount();
    expect(r.abortCalls).toBe(1);
    r.stop(); // even if the engine still flushes
    await flush(40);
    r.final("find the part about Terebratulina and read it"); // and even a handler that were still attached would be inert
    await flush();
    expect(calls.read).toBe(0);
    expect(fetchLog).toEqual([]);
  });

  it("VOICE-6: the late end of an earlier recogniser does not orphan the next one", async () => {
    await mount();
    await click(mic());
    const r1 = FakeRec.instances[0];
    await flush();
    await act(async () => r1.final("find the part about chalk"));
    await flush();
    await click(mic()); // a second session while the first has not fired its end yet
    const r2 = FakeRec.instances[1];
    await flush();
    await act(async () => r1.end());
    await flush();
    expect(mic().getAttribute("aria-label")).toBe("Stop listening");
    await unmount();
    expect(r2.abortCalls).toBe(1); // the live recogniser was released
  });

  it("VOICE-7: typing while listening wins; a late spoken result cannot overwrite it", async () => {
    await mount();
    await click(mic());
    const r = FakeRec.instances[0];
    await flush();
    await act(async () => r.interim("find the part about"));
    expect(input().value).toBe("find the part about");
    r.pendingFinal = "find the part about Terebratulina";
    await type("find the part about crocodiles");
    await act(async () => r.interim("find the part about Terebratulina")); // more speech arrives: the typed text stays
    expect(input().value).toBe("find the part about crocodiles");
    await submit();
    await flush(60);
    expect(shownTopic()).toBe("crocodiles");
    expect(input().value).toBe("find the part about crocodiles");
    expect(r.abortCalls).toBe(1); // submitted with abort(), so the recogniser's flush never arrives
  });

  it("VOICE-7: a final result that arrives after the reader typed (and before Enter) neither overwrites the text nor searches", async () => {
    await mount();
    await click(mic());
    const r = FakeRec.instances[0];
    await flush();
    await act(async () => r.interim("find the part about"));
    await type("find the part about crocodiles");
    await act(async () => r.final("find the part about Terebratulina"));
    await flush(60);
    expect(input().value).toBe("find the part about crocodiles");
    expect(shownTopic()).toBeUndefined(); // nothing was searched on the spoken words
    await submit();
    await flush(60);
    expect(shownTopic()).toBe("crocodiles");
  });

  it("VOICE-7: a slow answer to an older question cannot replace the newer one", async () => {
    let releaseFirst!: () => void;
    let n = 0;
    vi.stubGlobal("fetch", (url: string) => {
      fetchLog.push({ url: String(url) });
      const mine = ++n;
      const respond = () => new Response(JSON.stringify({ scores: [{ key: "0", score: 0.9 }] }), { status: 200 });
      return mine === 1 ? new Promise<Response>((r) => (releaseFirst = () => r(respond()))) : Promise.resolve(respond());
    });
    await mount({ serverKey: true });
    await type("coccoliths");
    await submit();
    await type("Terebratulina");
    await submit();
    await flush(30);
    expect(shownTopic()).toBe("Terebratulina");
    releaseFirst();
    await flush(30);
    expect(shownTopic()).toBe("Terebratulina");
  });

  it("VOICE-8: a session that ends without hearing anything says so", async () => {
    await mount();
    await click(mic());
    await flush();
    await act(async () => FakeRec.instances[0].end());
    expect(alertText()).toMatch(/stopped before anything was heard/i);
    expect(mic().getAttribute("aria-label")).toBe("Start listening");
  });

  it("VOICE-8: hiding the page stops listening and explains why", async () => {
    await mount();
    await click(mic());
    await flush();
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    expect(FakeRec.instances[0].abortCalls).toBe(1);
    expect(alertText()).toMatch(/page was hidden/i);
  });

  it("VOICE-8/11: 'Listening' is shown only once capture really started; the screen-reader line follows the phases", async () => {
    FakeRec.autoStart = false;
    await mount();
    await click(mic());
    expect(mic().getAttribute("aria-label")).toBe("Cancel"); // asked for the microphone, not recording yet
    expect(document.querySelector('[role="status"]')!.textContent).toBe("Waiting for the microphone");
    await act(async () => FakeRec.instances[0].onstart?.()); // the permission prompt was accepted
    expect(mic().getAttribute("aria-label")).toBe("Stop listening");
    expect(document.querySelector('[role="status"]')!.textContent).toBe("Listening");
  });

  it("VOICE-9: when the browser's recogniser is blocked, a server key makes the panel transcribe on the server instead", async () => {
    const stream = new FakeStream();
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => stream }, configurable: true });
    await mount({ serverKey: true });
    await click(mic());
    await flush();
    await act(async () => FakeRec.instances[0].onerror?.({ error: "service-not-allowed" }));
    await flush(30);
    expect(recorders).toHaveLength(1);
    expect(mic().getAttribute("aria-label")).toBe("Stop listening");
    expect(alertText()).toBeNull();
  });

  it("VOICE-9: without a key the same failure is explained, with its own wording (not 'microphone denied')", async () => {
    await mount();
    await click(mic());
    await flush();
    await act(async () => FakeRec.instances[0].onerror?.({ error: "service-not-allowed" }));
    expect(alertText()).toMatch(/turned off or blocked in this browser/i);
    expect(alertText()).not.toMatch(/microphone/i);
  });

  it("VOICE-10: read-aloud is asked to step aside when the microphone is about to be used", async () => {
    await mount();
    await click(mic());
    expect(calls.listenStart).toBe(1);
  });

  it("VOICE-11: focus goes to the question on open and back where it was on close; Tab stays inside; errors are announced", async () => {
    const opener = document.body.appendChild(document.createElement("button"));
    opener.focus();
    await mount();
    expect(document.activeElement).toBe(input());
    const items = Array.from(document.querySelector("section")!.querySelectorAll<HTMLElement>("button, input"));
    items.at(-1)!.focus();
    await act(async () => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.querySelector("section")!.contains(document.activeElement)).toBe(true);
    await click(mic());
    await flush();
    await act(async () => FakeRec.instances[0].onerror?.({ error: "no-speech" }));
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    await unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("VOICE-12: says where the voice goes", async () => {
    await mount();
    expect(panel()).toMatch(/processed by your browser's speech service/i);
    expect(panel()).not.toMatch(/Together AI/); // no key: nothing is sent to Together
    await unmount();
    await mount({ serverKey: true });
    expect(panel()).toMatch(/sends your question and a few short excerpts of this text to Together AI/i);
  });

  it("the meaning search only reorders: it cannot make a weak match look confident", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ scores: Array.from({ length: 12 }, (_, i) => ({ key: String(i), score: 0.95 })) }), { status: 200 }));
    await mount({ serverKey: true });
    await type("sea");
    await submit();
    await flush(30);
    expect(panel()).toMatch(/Possible matches/);
    expect(panel()).toMatch(/words \+ meaning/);
  });

  it("says plainly when the meaning search is unavailable", async () => {
    await mount({ serverKey: true });
    await type("coccoliths");
    await submit();
    await flush(30);
    expect(panel()).toMatch(/words only \(meaning search unavailable\)/);
  });
});

describe("server transcription fallback (no browser recogniser)", () => {
  const grant = (stream: FakeStream) => Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: async () => stream }, configurable: true });
  beforeEach(() => void delete win.SpeechRecognition);

  it("VOICE-4: closing while the permission prompt is open means nothing is recorded when it is granted later", async () => {
    let allow!: (s: FakeStream) => void;
    const stream = new FakeStream();
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: () => new Promise<FakeStream>((r) => (allow = r)) }, configurable: true });
    await mount({ serverKey: true });
    await click(mic());
    expect(mic().getAttribute("aria-label")).toBe("Cancel");
    await unmount();
    allow(stream);
    await flush(30);
    expect(stream.tracks[0].stopCalls).toBeGreaterThan(0); // released at once
    expect(recorders.filter((r) => r.state === "recording")).toHaveLength(0);
    expect(fetchLog.filter((f) => f.url.includes("transcribe"))).toEqual([]);
  });

  it("VOICE-4: pressing Cancel during the prompt does the same", async () => {
    let allow!: (s: FakeStream) => void;
    const stream = new FakeStream();
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: () => new Promise<FakeStream>((r) => (allow = r)) }, configurable: true });
    await mount({ serverKey: true });
    await click(mic());
    await click(mic()); // "Cancel"
    expect(mic().getAttribute("aria-label")).toBe("Start listening");
    allow(stream);
    await flush(30);
    expect(stream.tracks[0].stopCalls).toBeGreaterThan(0);
    expect(recorders.filter((r) => r.state === "recording")).toHaveLength(0);
  });

  it("VOICE-3: without a recorder the microphone is never even requested, and the reason is shown", async () => {
    const getUserMedia = vi.fn(async () => new FakeStream());
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    delete win.MediaRecorder;
    await mount({ serverKey: true });
    await click(mic());
    await flush();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(alertText()).toMatch(/cannot record audio/i);
  });

  it("VOICE-3: if the recorder fails to start after the microphone was granted, the microphone is released", async () => {
    const stream = new FakeStream();
    grant(stream);
    win.MediaRecorder = class {
      static isTypeSupported() {
        return true;
      }
      constructor() {
        throw new DOMException("mime type not supported", "NotSupportedError");
      }
    };
    await mount({ serverKey: true });
    await click(mic());
    await flush();
    expect(stream.tracks[0].stopCalls).toBeGreaterThan(0);
    expect(alertText()).toMatch(/could not start the microphone/i);
  });

  it("VOICE-3: a level meter that cannot be built does not break recording", async () => {
    const stream = new FakeStream();
    grant(stream);
    win.AudioContext = class {
      constructor() {
        throw new Error("AudioContext unavailable");
      }
    };
    await mount({ serverKey: true });
    await click(mic());
    await flush();
    expect(recorders[0].state).toBe("recording");
    expect(mic().getAttribute("aria-label")).toBe("Stop listening");
    expect(alertText()).toBeNull();
  });

  it("VOICE-5: an upload that fails to reach the network ends with a message, not an endless 'Transcribing…'", async () => {
    grant(new FakeStream());
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await mount({ serverKey: true });
    await click(mic());
    await flush();
    await click(mic()); // stop
    await flush(40);
    expect(alertText()).toMatch(/could not reach the transcription service/i);
    expect(input().placeholder).not.toMatch(/Transcribing/);
  });

  it("VOICE-15: an empty transcription says no speech was heard", async () => {
    grant(new FakeStream());
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ text: "  " }), { status: 200 }));
    await mount({ serverKey: true });
    await click(mic());
    await flush();
    await click(mic());
    await flush(40);
    expect(alertText()).toMatch(/no speech was heard/i);
  });

  it("VOICE-15: a transcription is searched straight away, like a spoken result from the browser; no language hint is sent", async () => {
    grant(new FakeStream());
    let sent: FormData | null = null;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      fetchLog.push({ url: String(url) });
      if (String(url).includes("transcribe")) {
        sent = init!.body as FormData;
        return new Response(JSON.stringify({ text: "find the part about coccoliths" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 500 });
    });
    await mount({ serverKey: true });
    await click(mic());
    await flush();
    await click(mic());
    await flush(60);
    expect(shownTopic()).toBe("coccoliths");
    expect(sent!.has("language")).toBe(false);
    expect(sent!.has("audio")).toBe(true);
  });

  it("VOICE-16: says why the microphone cannot be used on an insecure page", async () => {
    Object.defineProperty(window, "isSecureContext", { value: false, configurable: true });
    await mount({ serverKey: true });
    await click(mic());
    await flush();
    expect(alertText()).toMatch(/secure \(https\) page or on localhost/i);
  });

  it("VOICE-16: tells apart a missing microphone, a busy one and a blocked one", async () => {
    const cases: [string, RegExp][] = [
      ["NotFoundError", /no microphone was found/i],
      ["NotReadableError", /busy in another app/i],
      ["NotAllowedError", /blocked or the permission prompt was dismissed/i],
    ];
    for (const [name, expected] of cases) {
      Object.defineProperty(navigator, "mediaDevices", {
        value: {
          getUserMedia: async () => {
            throw new DOMException("x", name);
          },
        },
        configurable: true,
      });
      await mount({ serverKey: true });
      await click(mic());
      await flush();
      expect(alertText(), name).toMatch(expected);
      await unmount();
    }
  });
});
