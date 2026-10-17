import { expect, test, type Page } from "@playwright/test";
import { openReader, selectInBlock } from "./helpers";

/**
 * The reader at phone and tablet widths: every control the reader needs is on screen and reachable, nothing makes the page scroll
 * sideways, and the panels leave part of the text visible. The first version of the Understand button was cut off the right edge of a
 * 375 px screen, so the Notebook could not be tapped at all; these checks are there to keep that from coming back.
 */
const SIZES = [
  { name: "320", width: 320, height: 640 },
  { name: "360", width: 360, height: 740 },
  { name: "375", width: 375, height: 812 },
  { name: "412", width: 412, height: 915 },
  { name: "768", width: 768, height: 1024 },
];

async function insideViewport(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const els = [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => e.getClientRects().length);
    return els.map((e) => {
      const r = e.getBoundingClientRect();
      return { label: e.getAttribute("aria-label") ?? e.textContent?.trim().slice(0, 20) ?? sel, left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: window.innerWidth, h: window.innerHeight };
    });
  }, selector);
}

for (const size of SIZES) {
  test.describe(`reader at ${size.name} px`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("the top bar is fully on screen, its buttons are tappable, and the page does not scroll sideways", async ({ page }) => {
      await openReader(page);
      const buttons = await insideViewport(page, "header nav button, header nav a");
      expect(buttons.length).toBeGreaterThanOrEqual(5);
      for (const b of buttons) {
        expect(b.left, `${b.label} starts on screen`).toBeGreaterThanOrEqual(0);
        expect(b.right, `${b.label} ends on screen at ${size.width}`).toBeLessThanOrEqual(b.w);
      }
      for (const name of ["Notebook", "Understand", "Find in this text", "Appearance and answers"]) {
        const btn = page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
        await expect(btn).toBeVisible();
        const box = (await btn.boundingBox())!;
        expect(box.width, `${name} is wide enough to tap`).toBeGreaterThanOrEqual(32);
        expect(box.height).toBeGreaterThanOrEqual(32);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });

    test("the Notebook and the Understand panel open with a tap, fit the screen and leave text visible above them at phone width", async ({ page }) => {
      await openReader(page);
      for (const [name, label] of [["Notebook", "Notebook"], ["Understand", "Understand"]] as const) {
        await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().click();
        const panel = page.getByRole("complementary", { name: label });
        await expect(panel).toBeVisible();
        await page.waitForTimeout(600); // the sheet slides in; measure it where it comes to rest
        const box = (await panel.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(size.width + 0.5);
        expect(box.y + box.height).toBeLessThanOrEqual(size.height + 0.5);
        if (size.width < 640) expect(box.y, "some text stays visible above the sheet").toBeGreaterThan(60);
        expect(await panel.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
        await page.keyboard.press("Escape");
        await expect(panel).toHaveCount(0);
      }
    });

    test("the find bar and the selection toolbar fit the screen with every control reachable", async ({ page }) => {
      await openReader(page);
      await page.getByRole("button", { name: "Find in this text" }).click();
      const bar = page.getByRole("search", { name: "Find in this text" });
      await expect(bar).toBeVisible();
      await page.waitForTimeout(500); // entrance animation
      for (const b of await insideViewport(page, '[role="search"] button, [role="search"] input')) {
        expect(b.left, b.label).toBeGreaterThanOrEqual(0);
        expect(b.right, b.label).toBeLessThanOrEqual(b.w);
      }
      await page.keyboard.press("Escape");
      await selectInBlock(page, "p2", 0, 50);
      const lens = page.getByRole("toolbar", { name: "Actions for the selection" });
      await expect(lens).toBeVisible();
      const items = await insideViewport(page, '[role="toolbar"][aria-label="Actions for the selection"] button');
      expect(items.length).toBeGreaterThanOrEqual(8);
      for (const b of items) {
        expect(b.left, `${b.label} is not cut off on the left`).toBeGreaterThanOrEqual(0);
        expect(b.right, `${b.label} is not cut off on the right at ${size.width}`).toBeLessThanOrEqual(b.w);
        expect(b.top).toBeGreaterThanOrEqual(0);
      }
      expect(await lens.evaluate((el) => (el.querySelector(".no-scrollbar") as HTMLElement).scrollWidth - (el.querySelector(".no-scrollbar") as HTMLElement).clientWidth)).toBeLessThanOrEqual(0);
    });
  });
}
