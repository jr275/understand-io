import { expect, test } from "@playwright/test";
import { openReader } from "./helpers";

test.describe("reading position", () => {
  test("a text opens where the reader left off", async ({ page }) => {
    await openReader(page);
    // Scroll by hand to a paragraph far down, as a reader would (progress only counts the reader's own scrolling).
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 9000);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(6000);
    const saved = await page.waitForFunction(() => {
      const raw = localStorage.getItem("gloss:v1");
      const p = raw ? (JSON.parse(raw).progress ?? {}) : {};
      const e = Object.values(p)[0] as { blockId?: string; ratio: number } | undefined;
      return e && e.blockId && e.ratio > 0.1 ? e : null;
    });
    const { blockId } = (await saved.jsonValue()) as { blockId: string };
    await page.reload();
    await page.locator("[data-reader-ready]").waitFor({ state: "attached" });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(3000);
    // The saved paragraph is on screen.
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const r = document.querySelector(`.blk[data-block="${id}"]`)!.getBoundingClientRect();
          return r.bottom > 0 && r.top < window.innerHeight;
        }, blockId),
      )
      .toBe(true);
  });

  test("after jumping to a citation or a search match, a button takes the reader back to where they were", async ({ page }) => {
    await openReader(page);
    await page.mouse.move(700, 400);
    await page.mouse.wheel(0, 1500);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1200);
    const from = await page.evaluate(() => window.scrollY);
    await expect(page.getByRole("button", { name: "Back to where you were" })).toHaveCount(0);
    // Jump with the find bar's sections menu to the last heading.
    await page.keyboard.press("s");
    const bar = page.getByRole("search", { name: "Find in this text" });
    await bar.getByRole("button", { name: "Sections" }).click();
    await bar.getByRole("menuitem", { name: /Notes/ }).click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(from + 2000);
    const back = page.getByRole("button", { name: "Back to where you were" });
    await expect(back).toBeVisible();
    await back.click();
    await expect.poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - from)).toBeLessThan(40);
    await expect(back).toHaveCount(0);
  });
});
