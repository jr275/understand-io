import { expect, test, type Locator, type Page } from "@playwright/test";
import { selectInBlock } from "../e2e/helpers";

/**
 * Visual regression baselines: the main screens in all five themes at desktop and phone size, plus the panels in two themes.
 * A change that moves pixels shows up as a failing comparison with the expected, actual and diff images in test-results/.
 *
 * What this does and does not tell you:
 * - Baselines are PNGs made by this machine's Chromium and fonts (the file names carry the platform). On another operating system, regenerate them
 *   first (`pnpm test:visual:update`) and review the images; they are not portable.
 * - A failing comparison means "this looks different", not "this is wrong". Look at the diff, and update the baseline when the change is intended.
 * - The content is fixed on purpose: a fresh reader, the built-in sample text, the model answered by a stand-in, no animation, no dev overlay.
 */
const THEMES = ["paper", "night", "sepia", "snow", "ink"] as const;
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 375, height: 812 } } as const;
const PANEL_THEMES = ["paper", "night"] as const;
const SAMPLE = "/read/on-a-piece-of-chalk";

async function prepare(page: Page, theme: string, size: keyof typeof SIZES) {
  await page.setViewportSize(SIZES[size]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((t) => {
    localStorage.setItem("gloss:settings", JSON.stringify({ theme: t }));
    localStorage.setItem("gloss:nudge", "1"); // the one-time phone hint toast
  }, theme);
  // The framework's development indicator is not part of the product, and the empty margin hint is not what these comparisons are about.
  await page.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important} .rg-margin p{visibility:hidden!important}";
    document.addEventListener("DOMContentLoaded", () => document.head.appendChild(style));
  });
  await page.route("**/api/ai", async (route) => {
    const sent = route.request().postDataJSON() as { variant?: string; blocks: { id: string; n?: number; text: string }[]; totalParagraphs: number };
    const real = sent.blocks.find((b) => b.n && b.text.length > 80)!;
    await route.fulfill({
      json: {
        result: {
          kind: "summary",
          variant: sent.variant ?? "executive",
          items: [
            { label: "Thesis", text: "The ground beneath a county is a record of an ancient sea, and the chalk can be read like a book.", basis: "text", evidence: [{ blockId: real.id, n: real.n, quote: real.text.slice(0, 40), start: 0, end: 40 }] },
            { label: "Main arguments", text: "Microscopic shells make up most of the rock.", basis: "interpretation", unverified: true, evidence: [] },
          ],
          caveats: ["The text gives no dates."],
          coverage: { used: sent.totalParagraphs, total: sent.totalParagraphs, from: 1, to: sent.totalParagraphs, complete: true },
        },
        model: "test/model",
        usage: { input: 1, output: 1, cost: 0 },
      },
    });
  });
}

async function settle(page: Page) {
  await page.mouse.move(0, 0); // no tooltip left open under the pointer
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1800); // the library shelf and the empty margin hint finish their entrance (timers, not CSS) after about 1.2 s
}

// The library's filter chips render with sub-pixel differences from one run to the next, so on the library they are masked. The empty margin hint
// ("This area is for notes") does the same and is hidden everywhere (a mask would also cover whatever panel is open over that corner).
// The rest of the page is compared with a tolerance of 0.05 % of its pixels.
const shot = (page: Page, name: string, mask: Locator[] = []) =>
  expect(page).toHaveScreenshot(`${name}.png`, { animations: "disabled", caret: "hide", maxDiffPixelRatio: 0.0005, mask, maskColor: "#808080" });

for (const size of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
  for (const theme of THEMES) {
    test.describe(`${theme} ${size}`, () => {
      test("landing", async ({ page }) => {
        await prepare(page, theme, size);
        await page.goto("/");
        await expect(page.getByLabel("Article link")).toBeVisible();
        await settle(page);
        await shot(page, `landing-${theme}-${size}`);
      });
      test("library", async ({ page }) => {
        await prepare(page, theme, size);
        await page.goto("/library");
        await expect(page.locator("button.bk")).toHaveCount(3);
        await settle(page);
        await shot(page, `library-${theme}-${size}`, [page.locator(".lib-chip-row")]);
      });
      test("reader", async ({ page }) => {
        await prepare(page, theme, size);
        await page.goto(SAMPLE);
        await page.locator("[data-reader-ready]").waitFor({ state: "attached" });
        await expect(page.locator(".prose-read .blk").first()).toBeVisible();
        await settle(page);
        await shot(page, `reader-${theme}-${size}`);
      });
    });
  }
  for (const theme of PANEL_THEMES) {
    test.describe(`panels ${theme} ${size}`, () => {
      test("understand panel with a result", async ({ page }) => {
        await prepare(page, theme, size);
        await page.goto(SAMPLE);
        await page.locator("[data-reader-ready]").waitFor({ state: "attached" });
        await page.keyboard.press("i");
        await page.getByRole("button", { name: "Executive summary" }).click();
        await expect(page.locator("[data-insight]")).toHaveCount(1);
        await settle(page);
        // The age of a result changes between runs.
        await shot(page, `understand-${theme}-${size}`);
      });
      test("understand panel before anything is made", async ({ page }) => {
        await prepare(page, theme, size);
        await page.goto(SAMPLE);
        await page.locator("[data-reader-ready]").waitFor({ state: "attached" });
        await page.keyboard.press("i");
        await expect(page.getByRole("list", { name: "What you can make" })).toBeVisible();
        await settle(page);
        await shot(page, `understand-empty-${theme}-${size}`);
      });
      test("selection toolbar", async ({ page }) => {
        await prepare(page, theme, size);
        await page.goto(SAMPLE);
        await page.locator("[data-reader-ready]").waitFor({ state: "attached" });
        await selectInBlock(page, "p2", 0, 50);
        await expect(page.getByRole("toolbar", { name: "Actions for the selection" })).toBeVisible();
        await settle(page);
        await shot(page, `toolbar-${theme}-${size}`);
      });
      test("find bar", async ({ page }) => {
        await prepare(page, theme, size);
        await page.goto(SAMPLE);
        await page.locator("[data-reader-ready]").waitFor({ state: "attached" });
        await page.keyboard.press("s");
        await page.getByRole("searchbox").fill("chalk");
        await expect(page.getByRole("status").filter({ hasText: /of \d+/ })).toBeVisible();
        await settle(page);
        await shot(page, `find-${theme}-${size}`);
      });
    });
  }
}
