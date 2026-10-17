import { expect, type Page } from "@playwright/test";

export const SAMPLE = "/read/on-a-piece-of-chalk";

/** Open a reader page and wait until the client has mounted its listeners. */
export async function openReader(page: Page, path = SAMPLE) {
  await page.goto(path);
  await page.locator("[data-reader-ready]").waitFor({ state: "attached" });
  await expect(page.locator(".prose-read .blk").first()).toBeVisible();
}

/** Select characters [from, to) of a block's text through the DOM and wait for the lens. */
export async function selectInBlock(page: Page, blockId: string, from: number, to: number) {
  await page.evaluate(
    ({ blockId, from, to }) => {
      const blk = document.querySelector(`.blk[data-block="${blockId}"]`)!;
      blk.scrollIntoView({ block: "center" });
      const text = blk.querySelector(".blk-text")!;
      const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
      let o = 0;
      let startNode: Node | null = null;
      let startOff = 0;
      let endNode: Node | null = null;
      let endOff = 0;
      let n: Node | null;
      while ((n = walker.nextNode())) {
        const len = n.textContent!.length;
        if (!startNode && from < o + len) {
          startNode = n;
          startOff = from - o;
        }
        if (to <= o + len) {
          endNode = n;
          endOff = to - o;
          break;
        }
        o += len;
      }
      const r = document.createRange();
      r.setStart(startNode!, startOff);
      r.setEnd(endNode!, endOff);
      const s = getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
    },
    { blockId, from, to },
  );
  await expect(page.getByRole("toolbar", { name: "Actions for the selection" })).toBeVisible();
}

export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => errors.push(`request failed: ${r.url()}`));
  return errors;
}

export interface FakeSpeechOptions {
  /** Real Chrome sometimes keeps `speechSynthesis.paused` after cancel(); enable to reproduce that. */
  cancelKeepsPaused?: boolean;
  /** How long one utterance "plays" before its end event. */
  msPerUtterance?: number;
  voices?: { voiceURI: string; name: string; lang: string; localService: boolean; default: boolean }[];
}

export interface SpeakCall {
  text: string;
  rate: number;
  lang: string;
  voice: string | null;
  /** The engine's `paused` flag when speak() was called: true means the utterance would be queued silently. */
  pausedAtSpeak: boolean;
}

/** Replace the browser speech engine with a deterministic fake (mock-based tests only). Everything spoken is logged in `window.__spoken` (text) and `window.__speakCalls`. */
export async function installFakeSpeech(page: Page, options: FakeSpeechOptions = {}) {
  await page.addInitScript((opts) => {
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
    const ms = opts.msPerUtterance ?? 300;
    const log: string[] = [];
    const calls: unknown[] = [];
    let current: FakeUtterance | null = null;
    let timer: number | undefined;
    const voices = opts.voices ?? [{ voiceURI: "fake-en", name: "Fake English", lang: "en-US", localService: true, default: true }];
    const finishLater = (u: FakeUtterance) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (current === u && !synth.paused) {
          synth.speaking = false;
          u.onend?.({});
        }
      }, ms);
    };
    const synth = {
      speaking: false,
      paused: false,
      pending: false,
      getVoices: () => voices,
      addEventListener: () => {},
      removeEventListener: () => {},
      speak(u: FakeUtterance) {
        current = u;
        synth.speaking = true;
        log.push(u.text);
        calls.push({ text: u.text, rate: u.rate, lang: u.lang, voice: u.voice?.voiceURI ?? null, pausedAtSpeak: synth.paused });
        finishLater(u);
      },
      cancel() {
        current = null;
        synth.speaking = false;
        if (!opts.cancelKeepsPaused) synth.paused = false;
        window.clearTimeout(timer);
      },
      pause() {
        synth.paused = true;
      },
      resume() {
        synth.paused = false;
        if (current) finishLater(current);
      },
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
    (window as unknown as { __spoken: string[] }).__spoken = log;
    (window as unknown as { __speakCalls: unknown[] }).__speakCalls = calls;
  }, options);
}

export const spokenText = (page: Page) => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.slice());
export const speakCalls = (page: Page) => page.evaluate(() => (window as unknown as { __speakCalls: SpeakCall[] }).__speakCalls.slice());
