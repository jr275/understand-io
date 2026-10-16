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

/** Replace the browser speech engine with a deterministic fake (mock-based tests only). */
export async function installFakeSpeech(page: Page) {
  await page.addInitScript(() => {
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
    const log: string[] = [];
    let current: FakeUtterance | null = null;
    let timer: number | undefined;
    const synth = {
      speaking: false,
      paused: false,
      pending: false,
      getVoices: () => [{ voiceURI: "fake-en", name: "Fake English", lang: "en-US", localService: true, default: true }],
      addEventListener: () => {},
      speak(u: FakeUtterance) {
        current = u;
        synth.speaking = true;
        log.push(u.text);
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          if (current === u && !synth.paused) {
            synth.speaking = false;
            u.onend?.({});
          }
        }, 300);
      },
      cancel() {
        current = null;
        synth.speaking = false;
        synth.paused = false;
        window.clearTimeout(timer);
      },
      pause() {
        synth.paused = true;
      },
      resume() {
        synth.paused = false;
        if (current) {
          const u = current;
          timer = window.setTimeout(() => {
            if (current === u) {
              synth.speaking = false;
              u.onend?.({});
            }
          }, 300);
        }
      },
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
    (window as unknown as { __spoken: string[] }).__spoken = log;
  });
}
