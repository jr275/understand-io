import { expect, test } from "@playwright/test";
import { SAMPLE } from "./helpers";

test.describe("mobile", () => {
  test("landing and reader lay out at phone width without horizontal scroll", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.goto(SAMPLE);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("On a Piece of Chalk");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    // Paragraph numbers are hidden below 720px; the composer is present.
    await expect(page.locator(".pnum").first()).toBeHidden();
    await expect(page.getByLabel("Ask anything about the whole text")).toBeVisible();
    await expect(page.getByRole("status")).toContainText(/Select any passage/);
  });

  test("library shelf scrolls horizontally instead of overflowing the page", async ({ page }) => {
    await page.goto("/library");
    await expect(page.locator("button.bk")).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
