import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openReader } from "./helpers";

const countInPage = (page: Page, word: string) =>
  page.evaluate((w) => [...document.querySelectorAll(".blk .blk-text")].reduce((n, el) => n + ((el.textContent ?? "").toLowerCase().split(w).length - 1), 0), word);

test.describe("find in the text (literal) and sections", () => {
  test("S opens the bar, marks every match, steps through them in order and Escape clears everything", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("s");
    const bar = page.getByRole("search", { name: "Find in this text" });
    await expect(bar).toBeVisible();
    const input = bar.getByRole("searchbox", { name: "Find in this text" });
    await expect(input).toBeFocused();
    await input.fill("chalk");
    const expected = await countInPage(page, "chalk");
    expect(expected).toBeGreaterThan(10);
    await expect(bar.getByRole("status")).toHaveText(`1 of ${expected}`);
    await expect(page.locator(".find-mark")).toHaveCount(expected);
    await expect(page.locator(".find-mark.is-current")).toHaveCount(1);
    // The current match is on screen.
    await expect.poll(() => page.locator(".find-mark.is-current").evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })).toBe(true);
    await input.press("Enter");
    await expect(bar.getByRole("status")).toHaveText(`2 of ${expected}`);
    await input.press("Shift+Enter");
    await input.press("Shift+Enter"); // wraps around from the first to the last
    await expect(bar.getByRole("status")).toHaveText(`${expected} of ${expected}`);
    await bar.getByRole("button", { name: "Next match" }).click();
    await expect(bar.getByRole("status")).toHaveText(`1 of ${expected}`);
    // The document itself is unchanged by marking.
    await expect(page.locator(".blk .blk-text").first()).toBeVisible();
    await input.press("Escape");
    await expect(bar).toHaveCount(0);
    await expect(page.locator(".find-mark")).toHaveCount(0);
  });

  test("says when nothing matches, and does not search for a single character", async ({ page }) => {
    await openReader(page);
    await page.getByRole("button", { name: "Find in this text" }).click();
    const bar = page.getByRole("search", { name: "Find in this text" });
    const input = bar.getByRole("searchbox");
    await input.fill("c");
    await expect(page.locator(".find-mark")).toHaveCount(0);
    await expect(bar.getByRole("status")).toHaveText("");
    await input.fill("quantum chromodynamics");
    await expect(bar.getByRole("status")).toHaveText("No matches");
    await expect(bar.getByRole("button", { name: "Next match" })).toBeDisabled();
  });

  test("ignores accents and case, and the match is the text as written", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("s");
    const input = page.getByRole("search").getByRole("searchbox");
    await input.fill("GLOBIGERINA");
    await expect(page.locator(".find-mark").first()).toBeVisible();
    expect(await page.locator(".find-mark.is-current").innerText()).toMatch(/^globigerina/i);
  });

  test("Sections lists the headings and goes to one", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("s");
    const bar = page.getByRole("search", { name: "Find in this text" });
    await bar.getByRole("button", { name: "Sections" }).click();
    await bar.getByRole("menuitem", { name: /Notes/ }).click();
    await expect.poll(() => page.locator('.blk[data-type="h2"]').first().evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; })).toBe(true);
  });

  test("literal search and meaning search are separate: 'Search by meaning' opens the question panel", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("s");
    await page.getByRole("search").getByRole("button", { name: "Search by meaning" }).click();
    await expect(page.getByRole("dialog", { name: "Ask by voice" })).toBeVisible();
    await expect(page.getByRole("search", { name: "Find in this text" })).toHaveCount(0);
  });

  test("the bar and the side panels give way to each other", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("s");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Find in this text" }).click();
    await expect(page.getByRole("search", { name: "Find in this text" })).toBeVisible();
    await page.getByRole("button", { name: "Notebook", exact: true }).click();
    await expect(page.getByRole("search", { name: "Find in this text" })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Notebook" })).toBeVisible();
    await page.getByRole("button", { name: "Find in this text" }).click();
    await expect(page.getByRole("complementary", { name: "Notebook" })).toHaveCount(0);
  });

  test("S is ignored when single-key shortcuts are off", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("gloss:settings", JSON.stringify({ keys: false })));
    await openReader(page);
    await page.keyboard.press("s");
    await expect(page.getByRole("search", { name: "Find in this text" })).toHaveCount(0);
    await page.getByRole("button", { name: "Find in this text" }).click();
    await expect(page.getByRole("search", { name: "Find in this text" })).toBeVisible();
  });

  test("the open bar has no accessibility violations", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("s");
    await page.getByRole("search").getByRole("searchbox").fill("chalk");
    await page.getByRole("search").getByRole("button", { name: "Sections" }).click();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
  });
});
