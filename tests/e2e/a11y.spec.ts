import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SAMPLE, openReader, selectInBlock } from "./helpers";

/**
 * Automated WCAG 2.0/2.1 A + AA and best-practice checks (axe-core) on the real UI states, in a light and a dark
 * theme. This guards the fixes from the accessibility review (colour tokens, landmarks, names, dialog roles).
 * It cannot replace keyboard and screen-reader testing: axe finds roughly a third of accessibility problems.
 */
async function violations(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
  return r.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target.join(" ")}`);
}

for (const theme of ["paper", "night"] as const) {
  test.describe(`axe — ${theme} theme`, () => {
    test.use({ reducedMotion: "reduce" });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("gloss:settings", JSON.stringify({ theme: t })), theme);
    });

    test("landing, with and without the paste dialog", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByLabel("Article link")).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.getByRole("button", { name: "Paste text" }).click();
      await expect(page.getByRole("dialog", { name: "Paste text" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("library, add panel and an open book", async ({ page }) => {
      await page.goto("/library");
      await expect(page.locator("button.bk")).toHaveCount(3);
      expect(await violations(page)).toEqual([]);
      await page.getByRole("button", { name: /Add articles/ }).click();
      await expect(page.getByRole("dialog", { name: "Add to the library" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await page.locator("button.bk").first().click();
      await expect(page.getByRole("dialog", { name: "On a Piece of Chalk" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("reader: base, appearance, selection toolbar, listen bar, voice search", async ({ page }) => {
      await openReader(page, SAMPLE);
      expect(await violations(page)).toEqual([]);
      await page.getByRole("button", { name: "Appearance and answers" }).click();
      await expect(page.getByRole("dialog", { name: "Appearance and answers" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await selectInBlock(page, "p2", 0, 40);
      expect(await violations(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await page.locator("body").click({ position: { x: 5, y: 300 } });
      await page.keyboard.press("l");
      await expect(page.getByRole("region", { name: "Reading aloud" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await page.keyboard.press("Escape");
      await page.keyboard.press("v");
      await expect(page.getByRole("dialog", { name: "Ask by voice" })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("phone width: landing and reader", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/");
      await expect(page.getByLabel("Article link")).toBeVisible();
      expect(await violations(page)).toEqual([]);
      await openReader(page, SAMPLE);
      expect(await violations(page)).toEqual([]);
    });
  });
}
