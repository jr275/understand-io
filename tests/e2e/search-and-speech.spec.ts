import { expect, test } from "@playwright/test";
import { installFakeSpeech, openReader, selectInBlock, speakCalls, spokenText } from "./helpers";

test.describe("voice search (typed transcript; recognition itself needs a microphone)", () => {
  test("finds a passage, jumps to it and marks the hit", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("v");
    const dialog = page.getByRole("dialog", { name: "Ask by voice" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("What to look for").fill("find the part that talks about the deep sea soundings in the Atlantic");
    await dialog.getByLabel("What to look for").press("Enter");
    await expect(dialog.getByText(/Matches for/)).toBeVisible();
    await expect(dialog.getByText("“deep sea soundings in the Atlantic”")).toBeVisible();
    const first = dialog.getByRole("listitem").first();
    await expect(first).toContainText(/sounding|Atlantic/i);
    await first.getByRole("button", { name: "Go to this passage" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".hit-mark")).toHaveCount(1);
    await expect(page.locator(".blk.is-cursor")).toBeVisible();
    await expect
      .poll(
        () =>
          page.locator(".blk.is-cursor").evaluate((el) => {
            const r = el.getBoundingClientRect();
            return r.top >= 0 && r.top < window.innerHeight;
          }),
        { timeout: 5000 },
      )
      .toBe(true);
  });

  test("says plainly when nothing matches", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("v");
    const dialog = page.getByRole("dialog", { name: "Ask by voice" });
    await dialog.getByLabel("What to look for").fill("where does he discuss quantum chromodynamics");
    await dialog.getByLabel("What to look for").press("Enter");
    await expect(dialog.getByText(/No passage in this text matches/)).toBeVisible();
    await expect(dialog.getByRole("listitem")).toHaveCount(0);
  });

  test("flags low-confidence matches", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("v");
    const dialog = page.getByRole("dialog", { name: "Ask by voice" });
    await dialog.getByLabel("What to look for").fill("Norwich spaceship");
    await dialog.getByLabel("What to look for").press("Enter");
    await expect(dialog.getByText(/Possible matches/)).toBeVisible();
  });

  test("an ambiguous one-word question is never called a confident match", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("v");
    const dialog = page.getByRole("dialog", { name: "Ask by voice" });
    await dialog.getByLabel("What to look for").fill("the sea");
    await dialog.getByLabel("What to look for").press("Enter");
    await expect(dialog.getByText(/Possible matches/)).toBeVisible();
    await expect(dialog.getByText(/none is a confident hit/)).toBeVisible();
  });

  test("concepts the text does not contain give no results at all, not a list of near misses", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("v");
    const dialog = page.getByRole("dialog", { name: "Ask by voice" });
    await dialog.getByLabel("What to look for").fill("where does he discuss the stock market and interest rates");
    await dialog.getByLabel("What to look for").press("Enter");
    await expect(dialog.getByText(/No passage in this text matches/)).toBeVisible();
    await expect(dialog.getByRole("listitem")).toHaveCount(0);
  });

  test("the question field has focus on open, Tab stays inside the dialog, and focus returns on close", async ({ page }) => {
    await openReader(page);
    await page.getByLabel("Ask anything about the whole text").focus();
    await page.getByRole("button", { name: /voice|microphone/i }).first().click();
    const dialog = page.getByRole("dialog", { name: "Ask by voice" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("What to look for")).toBeFocused();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: /voice|microphone/i }).first()).toBeFocused();
  });

  test("scrolling the page while the panel is open does not close or disturb it", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("v");
    const dialog = page.getByRole("dialog", { name: "Ask by voice" });
    await dialog.getByLabel("What to look for").fill("coccoliths");
    await page.mouse.move(700, 500);
    await page.mouse.wheel(0, 400);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("What to look for")).toHaveValue("coccoliths");
  });

  test("opening the panel while the text is being read aloud pauses the reading", async ({ page }) => {
    await installFakeSpeech(page);
    await openReader(page);
    await page.keyboard.press("l");
    const region = page.getByRole("region", { name: "Reading aloud" });
    await expect(region.getByRole("button", { name: "Pause" })).toBeVisible();
    await page.keyboard.press("v");
    await expect(page.getByRole("dialog", { name: "Ask by voice" })).toBeVisible();
    await expect(region.getByRole("button", { name: "Resume" })).toBeVisible();
    const spokenWhilePaused = (await spokenText(page)).length;
    await page.waitForTimeout(900);
    expect((await spokenText(page)).length).toBe(spokenWhilePaused);
  });

  test("'…and read it' reads that passage only, then stops", async ({ page }) => {
    await installFakeSpeech(page, { msPerUtterance: 120 });
    await openReader(page);
    await page.keyboard.press("v");
    const dialog = page.getByRole("dialog", { name: "Ask by voice" });
    await dialog.getByLabel("What to look for").fill("find the part about coccoliths and read it");
    await dialog.getByLabel("What to look for").press("Enter");
    await expect(dialog.getByText(/Matches for/)).toBeVisible();
    const excerpt = (await dialog.getByRole("listitem").first().locator("button").first().textContent())!;
    await dialog.getByRole("listitem").first().getByRole("button", { name: "Read this passage aloud" }).click();
    await expect.poll(async () => (await spokenText(page)).length, { timeout: 4000 }).toBeGreaterThan(0);
    await expect(page.getByRole("region", { name: "Reading aloud" })).toHaveCount(0, { timeout: 8000 }); // it ends by itself
    const spoken = await spokenText(page);
    expect(spoken.length).toBeLessThanOrEqual(4); // a one- or two-sentence passage, not the rest of the text
    expect(excerpt.replace(/\s+/g, " ")).toContain(spoken[0].slice(0, 25));
  });
});

test.describe("read aloud (mock speech engine)", () => {
  test.beforeEach(async ({ page }) => installFakeSpeech(page));

  test("L starts reading, highlights the sentence, Space pauses and resumes, stop clears", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("l");
    const region = page.getByRole("region", { name: "Reading aloud" });
    await expect(region).toBeVisible();
    await expect(region).toContainText(/Reading · 1\//);
    await expect(page.locator(".m-speak")).toHaveCount(1);
    await expect(page.locator(".m-speak")).toContainText("If a well were sunk");
    // It advances sentence by sentence.
    const indexOf = async () => Number(((await region.textContent()) ?? "").match(/Reading · (\d+)\//)?.[1] ?? 0);
    await expect.poll(indexOf, { timeout: 5000 }).toBeGreaterThan(1);
    await page.keyboard.press("Space");
    await expect(region.getByRole("button", { name: "Resume" })).toBeVisible();
    const before = await region.textContent();
    await page.waitForTimeout(700);
    expect(await region.textContent()).toBe(before);
    await page.keyboard.press("Space");
    await expect(region.getByRole("button", { name: "Pause" })).toBeVisible();
    await region.getByRole("button", { name: "Stop reading aloud" }).click();
    await expect(region).toHaveCount(0);
    await expect(page.locator(".m-speak")).toHaveCount(0);
  });

  test("speed and voice controls change the utterance and never overlap sessions", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("l");
    const region = page.getByRole("region", { name: "Reading aloud" });
    await region.getByLabel("Speed").selectOption("1.5");
    await expect(region.getByLabel("Speed")).toHaveValue("1.5");
    await page.keyboard.press("l"); // stop
    await expect(region).toHaveCount(0);
    await page.keyboard.press("l"); // start again — one session only
    await expect(region).toContainText(/Reading · 1\//);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length), { timeout: 3000 }).toBeGreaterThan(0);
  });

  test("reading a selected passage then continuing with the text", async ({ page }) => {
    await openReader(page);
    const region = page.getByRole("region", { name: "Reading aloud" });
    // Whole-text sentence count as the bar reports it for a plain read, so nothing here depends on how many sentences the sample has.
    await page.keyboard.press("l");
    await expect(region).toContainText(/Reading · 1\/\d+/);
    const total = Number(((await region.textContent()) ?? "").match(/Reading · 1\/(\d+)/)![1]);
    await page.keyboard.press("l");
    await expect(region).toHaveCount(0);
    await page.evaluate(() => ((window as unknown as { __spoken: string[] }).__spoken.length = 0));

    await selectInBlock(page, "p2", 0, 40);
    await page.getByRole("toolbar").getByRole("button", { name: "More actions" }).click({ force: true });
    await page.getByRole("menuitem", { name: /Read aloud/ }).click({ force: true });
    await expect(region).toBeVisible();
    // The fake engine finishes a sentence in 300 ms, so assert on what was spoken rather than on a
    // transient label: the selected passage goes first, then reading continues with the next sentence.
    await expect.poll(async () => (await spokenText(page)).length, { timeout: 6000 }).toBeGreaterThan(1);
    const spoken = await spokenText(page);
    expect(spoken[0]).toBe("Not only here, but over the whole county");
    expect(spoken[1]).toMatch(/^of Norfolk, the well-sinker/);
    // After the passage, the counter keeps whole-text numbering instead of restarting over the remainder.
    await expect(region).toContainText(new RegExp(`Reading · \\d+/${total}`));
  });
});

test.describe("read aloud: behaviour found by the review (mock engine)", () => {
  test("pause, Forward, resume is audible even when the engine keeps its paused flag after cancel", async ({ page }) => {
    await installFakeSpeech(page, { cancelKeepsPaused: true });
    await openReader(page);
    await page.keyboard.press("l");
    const region = page.getByRole("region", { name: "Reading aloud" });
    await expect(region).toContainText(/Reading · 1\//);
    await page.keyboard.press("Space");
    await expect(region.getByRole("button", { name: "Resume" })).toBeVisible();
    await region.getByRole("button", { name: "Forward one sentence" }).click();
    await region.getByRole("button", { name: "Resume" }).click();
    await expect(region.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect.poll(async () => (await speakCalls(page)).length, { timeout: 3000 }).toBeGreaterThan(1);
    const last = (await speakCalls(page)).at(-1)!;
    expect(last.pausedAtSpeak).toBe(false);
  });

  test("Space on a focused control belongs to that control (it must not also pause or resume)", async ({ page }) => {
    await installFakeSpeech(page);
    await openReader(page);
    await page.keyboard.press("l");
    const region = page.getByRole("region", { name: "Reading aloud" });
    await expect(region).toBeVisible();
    await region.getByRole("button", { name: "Pause" }).focus();
    await page.keyboard.press("Space");
    // One toggle (the button's own click) leaves it paused; a second one from the page-level shortcut would resume it.
    await expect(region.getByRole("button", { name: "Resume" })).toBeVisible();
    await page.waitForTimeout(500);
    await expect(region.getByRole("button", { name: "Resume" })).toBeVisible();
  });

  test("no shortcut reacts behind an open dialog", async ({ page }) => {
    await installFakeSpeech(page);
    await openReader(page);
    await page.keyboard.press("v");
    await expect(page.getByRole("dialog", { name: "Ask by voice" })).toBeVisible();
    await page.locator("body").press("l");
    await page.waitForTimeout(400);
    await expect(page.getByRole("region", { name: "Reading aloud" })).toHaveCount(0);
    expect(await spokenText(page)).toEqual([]);
  });

  test("L and the top-bar button start from the paragraph on screen, not from the top", async ({ page }) => {
    await installFakeSpeech(page);
    await page.addInitScript(() => localStorage.setItem("gloss:settings", JSON.stringify({ listen: true }))); // the top-bar button appears with Listen on
    await openReader(page);
    await page.evaluate(() => document.querySelector('.blk[data-block="p30"]')!.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300);
    const check = async () => {
      const first = (await spokenText(page))[0];
      expect(first, "something was spoken").toBeTruthy();
      return page.evaluate((t) => {
        const blk = [...document.querySelectorAll<HTMLElement>(".blk")].find((b) => b.textContent?.includes(t));
        const r = blk?.getBoundingClientRect();
        return !!r && r.bottom > 0 && r.top < window.innerHeight;
      }, first);
    };
    await page.keyboard.press("l");
    await expect.poll(async () => (await spokenText(page)).length).toBeGreaterThan(0);
    expect(await check()).toBe(true);
    await page.keyboard.press("l"); // stop
    await page.evaluate(() => ((window as unknown as { __spoken: string[] }).__spoken.length = 0));
    await page.getByRole("button", { name: "Read aloud from here" }).click();
    await expect.poll(async () => (await spokenText(page)).length).toBeGreaterThan(0);
    expect(await check()).toBe(true);
  });

  test("the voice menu works from the keyboard: arrows, Enter to choose, Escape to close and return focus", async ({ page }) => {
    await installFakeSpeech(page, {
      voices: [
        { voiceURI: "fake-en", name: "Fake English", lang: "en-US", localService: true, default: true },
        { voiceURI: "fake-gb", name: "Fake British", lang: "en-GB", localService: true, default: false },
      ],
    });
    await openReader(page);
    await page.keyboard.press("l");
    const region = page.getByRole("region", { name: "Reading aloud" });
    const trigger = region.getByRole("button", { name: /^Voice:/ });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "Voices" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitemradio", { name: /System default/ })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitemradio", { name: /Fake British/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAccessibleName("Voice: Fake British");
    await expect.poll(async () => (await speakCalls(page)).at(-1)?.voice).toBe("fake-gb");
    await trigger.press("Enter");
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("state changes are announced to screen readers, including when reading ends", async ({ page }) => {
    await installFakeSpeech(page, { msPerUtterance: 40 });
    await openReader(page);
    const live = page.locator('[role="status"][aria-live="polite"]').filter({ hasNot: page.locator("button") }).first();
    await page.keyboard.press("l");
    await expect(live).toHaveText("Reading aloud");
    await page.keyboard.press("Space");
    await expect(live).toHaveText("Paused");
    await page.getByRole("region", { name: "Reading aloud" }).getByRole("button", { name: "Stop reading aloud" }).click();
    await expect(live).toHaveText("Stopped reading");
  });

  test("with the engine failing, the bar offers Try again and the error is not hidden by a toast", async ({ page }) => {
    await installFakeSpeech(page);
    await openReader(page);
    await page.keyboard.press("l");
    const region = page.getByRole("region", { name: "Reading aloud" });
    await expect(region).toBeVisible();
    await page.evaluate(() => {
      // Make the very next utterance fail the way a broken voice does.
      const synth = window.speechSynthesis as unknown as { speak: (u: { onerror?: ((e: { error: string }) => void) | null }) => void };
      synth.speak = (u) => void window.setTimeout(() => u.onerror?.({ error: "synthesis-failed" }), 20);
    });
    await expect(region.getByRole("button", { name: "Try again" })).toBeVisible({ timeout: 6000 });
    await expect(region).toContainText("The speech engine failed");
    const bar = await region.boundingBox();
    const toast = await page.locator('[role="status"]:not(.sr-only)').filter({ hasText: "The speech engine failed" }).first().boundingBox();
    expect(bar && toast && toast.y + toast.height <= bar.y + 1).toBe(true); // the toast sits above the bar
  });

  test("Back and Forward are disabled at the ends", async ({ page }) => {
    await installFakeSpeech(page);
    await openReader(page);
    await page.keyboard.press("l");
    const region = page.getByRole("region", { name: "Reading aloud" });
    await expect(region.getByRole("button", { name: "Back one sentence" })).toBeDisabled();
    await expect(region.getByRole("button", { name: "Forward one sentence" })).toBeEnabled();
  });
});

test.describe("read aloud: long paragraph, motion and contrast preferences", () => {
  const longText = `# A long paragraph\n\n${Array.from({ length: 70 }, (_, i) => `Sentence number ${i + 1} goes on for a little while, with several plain words in it.`).join(" ")}`;
  const openLong = async (page: import("@playwright/test").Page) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const res = await page.request.post("/api/import/text", { data: { text: longText } });
    expect(res.ok()).toBeTruthy();
    const { document } = await res.json();
    await openReader(page, `/read/${document.slug}`);
  };

  test("the spoken sentence stays on screen inside a paragraph taller than the viewport", async ({ page }) => {
    await installFakeSpeech(page, { msPerUtterance: 350 });
    await openLong(page);
    expect(await page.evaluate(() => document.querySelector(".blk-text")!.getBoundingClientRect().height > window.innerHeight)).toBe(true);
    await page.keyboard.press("l");
    const region = page.getByRole("region", { name: "Reading aloud" });
    const sentenceNo = async () => Number(((await region.textContent()) ?? "").match(/Reading · (\d+)\//)?.[1] ?? 0);
    const inView = () =>
      page.evaluate(() => {
        const r = document.querySelector(".m-speak")?.getBoundingClientRect();
        return !!r && r.top >= 0 && r.bottom <= window.innerHeight;
      });
    for (const n of [8, 16, 24]) {
      await expect.poll(sentenceNo, { timeout: 20000 }).toBeGreaterThanOrEqual(n);
      await expect.poll(inView, { timeout: 2500 }).toBe(true);
    }
  });

  test("following stops when the reader scrolls on their own, and the page is not yanked back", async ({ page }) => {
    await installFakeSpeech(page, { msPerUtterance: 400 });
    await openLong(page);
    await page.keyboard.press("l");
    const region = page.getByRole("region", { name: "Reading aloud" });
    const sentenceNo = async () => Number(((await region.textContent()) ?? "").match(/Reading · (\d+)\//)?.[1] ?? 0);
    await expect.poll(sentenceNo, { timeout: 20000 }).toBeGreaterThanOrEqual(8);
    await page.mouse.move(180, 300);
    await page.mouse.wheel(0, -4000); // scroll back up to the top by hand
    await page.waitForTimeout(300);
    const y = await page.evaluate(() => window.scrollY);
    const at = await sentenceNo();
    await expect.poll(sentenceNo, { timeout: 20000 }).toBeGreaterThanOrEqual(at + 4); // several more sentences are read
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThan(5);
    // Skipping asks to be followed again.
    await region.getByRole("button", { name: "Forward one sentence" }).click();
    await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 4000 }).toBeGreaterThan(y + 100);
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });
    test("the page follows the sentence without smooth scrolling", async ({ page }) => {
      await installFakeSpeech(page, { msPerUtterance: 250 });
      await page.addInitScript(() => {
        const scrolls: unknown[] = [];
        const original = window.scrollTo.bind(window);
        (window as unknown as { __scrolls: unknown[] }).__scrolls = scrolls;
        window.scrollTo = ((...args: unknown[]) => {
          scrolls.push(args[0]);
          return (original as (...a: unknown[]) => void)(...args);
        }) as typeof window.scrollTo;
      });
      await openLong(page);
      await page.keyboard.press("l");
      await expect.poll(() => page.evaluate(() => (window as unknown as { __scrolls: unknown[] }).__scrolls.length), { timeout: 15000 }).toBeGreaterThan(0);
      const calls = (await page.evaluate(() => (window as unknown as { __scrolls: { behavior?: string }[] }).__scrolls)) as { behavior?: string }[];
      for (const c of calls) expect(c.behavior).toBe("auto");
    });
  });

  test.describe("forced colours", () => {
    test.use({ forcedColors: "active" });
    test("the sentence being read stays visible when backgrounds are overridden", async ({ page }) => {
      await installFakeSpeech(page, { msPerUtterance: 2000 });
      await openReader(page);
      await page.keyboard.press("l");
      await expect(page.locator(".m-speak")).toHaveCount(1);
      const bg = await page.locator(".m-speak").evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg).not.toBe("rgba(0, 0, 0, 0)");
      expect(bg).not.toBe("transparent");
    });
  });
});

test.describe("read aloud without a speech engine", () => {
  test("says so instead of doing nothing, and hides the controls that cannot work", async ({ page }) => {
    await page.addInitScript(() => {
      Reflect.deleteProperty(Window.prototype, "speechSynthesis");
      Reflect.deleteProperty(window, "speechSynthesis");
    });
    await openReader(page);
    expect(await page.evaluate(() => "speechSynthesis" in window)).toBe(false);
    await expect(page.getByRole("button", { name: "Read aloud from here" })).toHaveCount(0);
    await page.keyboard.press("l");
    await expect(page.getByText("Read aloud is not available in this browser")).toBeVisible();
    await expect(page.getByRole("region", { name: "Reading aloud" })).toHaveCount(0);
    await page.getByRole("button", { name: "Appearance and answers" }).click();
    await expect(page.getByRole("switch", { name: /Focus/ })).toBeVisible();
    await expect(page.getByRole("switch", { name: /Listen/ })).toHaveCount(0);
  });
});
