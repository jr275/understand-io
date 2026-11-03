// @vitest-environment jsdom
import { act, createElement, useState, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import chalk from "@/content/samples/on-a-piece-of-chalk.json";
import type { Block, GlossTurn } from "@/lib/content/types";
import { VoiceSearch } from "@/components/reader/VoiceSearch";
import { I18nProvider } from "@/i18n/client";

// The provider's children are optional for the test: the component under test is passed as the third argument.
const Provider = I18nProvider as unknown as ComponentType<{ locale: "en"; children?: ReactNode }>;

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/" }));

/*
 * Ask mode of the voice panel: a question typed or spoken becomes a margin answer shown here, with checked citations, read aloud only
 * when the reader wants it, never while the microphone is on. Browser speech recognition and synthesis are fakes (no microphone, no audio);
 * the model is not involved at all (the panel only receives the conversation the reader would show).
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const blocks = (chalk as { blocks: Block[] }).blocks;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const flush = (ms = 50) => act(async () => void (await sleep(ms)));

class FakeRec {
  static instances: FakeRec[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  onstart: (() => void) | null = null;
  abortCalls = 0;
  stopCalls = 0;
  start() {
    FakeRec.instances.push(this);
    setTimeout(() => this.onstart?.(), 0);
  }
  stop() {
    this.stopCalls++;
    setTimeout(() => this.onend?.(), 2);
  }
  abort() {
    this.abortCalls++;
  }
  final(text: string) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text, confidence: 0.9 }], { isFinal: true })] });
  }
}

type Handler = ((e: unknown) => void) | null;
class FakeUtterance {
  rate = 1;
  voice: unknown = null;
  lang = "";
  onend: Handler = null;
  onerror: Handler = null;
  constructor(public text: string) {}
}
const spoken: string[] = [];
let currentUtterance: FakeUtterance | null = null;
let cancels = 0;
const synth = {
  paused: false,
  getVoices: () => [] as unknown[],
  speak(u: FakeUtterance) {
    currentUtterance = u;
    spoken.push(u.text);
  },
  cancel() {
    cancels++;
    currentUtterance = null;
  },
  resume() {
    synth.paused = false;
  },
};

interface Conv {
  id: string;
  turns: GlossTurn[];
  status?: "streaming" | "done" | "error";
  error?: string;
  cites: Set<number> | null;
}
const calls = { ask: [] as [string, boolean][], close: 0, newConv: 0, show: [] as string[], cite: [] as number[], answerSpeak: 0, listenStart: 0 };
let root: Root;
let host: HTMLElement;
let setConv: (c: Conv | null) => Promise<void> = async () => {};

async function mount(initial: Conv | null = null, props: Record<string, unknown> = {}) {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  function App() {
    const [conversation, set] = useState<Conv | null>(initial);
    setConv = (c) => act(async () => set(c));
    return createElement(Provider, { locale: "en" }, createElement(VoiceSearch, {
      open: true,
      onClose: () => void calls.close++,
      blocks,
      lang: "en-US",
      onJump: () => {},
      onRead: () => {},
      onListenStart: () => void calls.listenStart++,
      serverKey: false,
      initialMode: "ask",
      onAsk: (q: string, again: boolean) => void calls.ask.push([q, again]),
      conversation,
      onNewConversation: () => void calls.newConv++,
      onShowAnswer: (id: string) => void calls.show.push(id),
      onCite: (n: number) => void calls.cite.push(n),
      onAnswerSpeak: () => void calls.answerSpeak++,
      voice: { rate: 1.25, voiceURI: null, lang: "en" },
      ...props,
    } as never));
  }
  await act(async () => root.render(createElement(App)));
}
const click = (el: Element | null) => act(async () => (el as HTMLElement).click());
const q = () => document.querySelector<HTMLInputElement>('input[aria-label="Your question about the text"]')!;
const type = (text: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(q(), text);
    q().dispatchEvent(new Event("input", { bubbles: true }));
  });
const submit = () => act(async () => void document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
const mic = () => document.querySelector<HTMLButtonElement>('button[aria-label="Start listening"], button[aria-label="Stop listening"], button[aria-label="Cancel"]')!;
const button = (name: RegExp) => [...document.querySelectorAll("button")].find((b) => name.test(b.textContent ?? "") || name.test(b.getAttribute("aria-label") ?? "")) ?? null;
const answerTurns = (text: string, status: Conv["status"] = "done", cites: Set<number> | null = new Set([2])): Conv => ({ id: "g1", turns: [{ role: "user", content: "What is chalk?" }, { role: "assistant", content: text }], status, cites });

beforeEach(() => {
  vi.useRealTimers();
  FakeRec.instances.length = 0;
  spoken.length = 0;
  cancels = 0;
  currentUtterance = null;
  Object.assign(calls, { ask: [], close: 0, newConv: 0, show: [], cite: [], answerSpeak: 0, listenStart: 0 });
  (window as unknown as Record<string, unknown>).SpeechRecognition = FakeRec;
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
  window.localStorage.clear();
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
});

describe("ask mode", () => {
  it("a typed question is handed to the reader as a question, not searched, and the microphone is never started", async () => {
    await mount();
    expect(document.querySelector("section")?.textContent).toContain("Ask about this text");
    await type("What is chalk made of?");
    await submit();
    expect(calls.ask).toEqual([["What is chalk made of?", false]]);
    expect(FakeRec.instances).toHaveLength(0);
    expect(document.querySelector("section")?.textContent).not.toMatch(/passages? found|No passage/);
  });

  it("a question spoken into the microphone is asked once the browser delivers it", async () => {
    await mount();
    await click(mic());
    await flush();
    await act(async () => FakeRec.instances[0].final("What does the author mean by chalk"));
    await flush();
    expect(calls.ask).toEqual([["What does the author mean by chalk", false]]);
  });

  it("shows the answer with checked citations: a paragraph the model was given links, any other is flagged and does not link", async () => {
    await mount(answerTurns("==Chalk is soft.== It is a rock ¶2, and a record of the sea ¶60."));
    const text = document.querySelector("[data-conversation]")!;
    expect(text.textContent).toContain("What is chalk?");
    expect(text.textContent).toContain("Chalk is soft.");
    const linked = [...text.querySelectorAll("button.cite")].map((b) => b.getAttribute("aria-label"));
    expect(linked).toContain("Jump to paragraph 2");
    expect(linked).not.toContain("Jump to paragraph 60");
    expect(text.querySelector('[data-unverified="60"]')).not.toBeNull();
    await click(text.querySelector('button[aria-label="Jump to paragraph 2"]'));
    expect(calls.cite).toEqual([2]);
    expect(calls.close).toBe(1);
  });

  it("a finished answer is read aloud once, after read-aloud of the text is told to stop, at the reader's rate", async () => {
    await mount(answerTurns("Chalk is soft. It is made of shells ¶2."));
    await flush(80);
    expect(calls.answerSpeak).toBe(1);
    expect(spoken).toEqual(["Chalk is soft."]);
    expect(currentUtterance).not.toBeNull();
    expect((currentUtterance as unknown as FakeUtterance).rate).toBe(1.25);
    await act(async () => currentUtterance!.onend?.({}));
    await flush(80);
    expect(spoken).toEqual(["Chalk is soft.", "It is made of shells."]);
    await setConv(answerTurns("Chalk is soft. It is made of shells ¶2.")); // an unrelated re-render does not repeat it
    await flush(80);
    expect(calls.answerSpeak).toBe(1);
  });

  it("an answer that is still being written is not spoken; it is spoken when it is done", async () => {
    await mount(answerTurns("Chalk is", "streaming"));
    await flush(80);
    expect(spoken).toEqual([]);
    expect(document.querySelector('[data-conversation] [aria-busy="true"]')).not.toBeNull();
    await setConv(answerTurns("Chalk is soft.", "done"));
    await flush(80);
    expect(spoken).toEqual(["Chalk is soft."]);
  });

  it("Stop speaking ends the voice at once, and the reader can start it again", async () => {
    await mount(answerTurns("One. Two. Three."));
    await flush(80);
    expect(button(/Stop speaking/)).not.toBeNull();
    await click(button(/Stop speaking/));
    expect(cancels).toBeGreaterThan(0);
    await act(async () => void currentUtterance?.onend?.({}));
    await flush(80);
    expect(spoken).toEqual(["One."]);
    expect(button(/Read this answer aloud/)).not.toBeNull();
    await click(button(/Read this answer aloud/));
    await flush(80);
    expect(spoken).toEqual(["One.", "One."]);
    expect(calls.answerSpeak).toBe(2);
  });

  it("with 'Read answers aloud' off, nothing is spoken", async () => {
    await mount(null);
    await click(document.querySelector('input[type="checkbox"]'));
    await setConv(answerTurns("Chalk is soft."));
    await flush(80);
    expect(spoken).toEqual([]);
  });

  it("the voice stops before the microphone starts, so the microphone never hears it", async () => {
    await mount(answerTurns("A long answer. With several sentences. And more."));
    await flush(80);
    expect(currentUtterance).not.toBeNull();
    const before = cancels;
    await click(mic());
    expect(cancels).toBeGreaterThan(before);
    expect(calls.listenStart).toBe(1);
    await flush();
    expect(FakeRec.instances).toHaveLength(1);
  });

  it("closing the panel stops the voice", async () => {
    await mount(answerTurns("A long answer. With several sentences."));
    await flush(80);
    const before = cancels;
    await act(async () => root.unmount());
    expect(cancels).toBeGreaterThan(before);
  });

  it("a follow-up continues the same conversation; New question starts a fresh one; Show in the margin hands the answer over", async () => {
    await mount(answerTurns("Chalk is soft."), { });
    await flush(80);
    await type("And what about flint?");
    await submit();
    expect(calls.ask).toEqual([["And what about flint?", true]]);
    await click(button(/Show in the margin/));
    expect(calls.show).toEqual(["g1"]);
    expect(calls.close).toBe(1);
    await click(button(/New question/));
    expect(calls.newConv).toBe(1);
  });

  it("a failed answer says so and is not spoken", async () => {
    await mount({ ...answerTurns("", "error"), error: "The shared AI service could not answer right now." });
    await flush(80);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not answer");
    expect(spoken).toEqual([]);
  });

  it("without any speech engine the answer is still shown, with a message instead of silence", async () => {
    // @ts-expect-error simulating a browser without speech synthesis
    delete window.speechSynthesis;
    vi.stubGlobal("SpeechSynthesisUtterance", undefined);
    await mount(answerTurns("Chalk is soft."));
    await flush(80);
    expect(document.querySelector("[data-conversation]")?.textContent).toContain("Chalk is soft.");
    expect(document.querySelector('[role="alert"]')?.textContent).toMatch(/cannot read aloud/);
  });
});
