import { expect, test } from "@playwright/test";
import { collectErrors } from "./helpers";

test.describe("landing", () => {
  test("renders the hero, import bar, samples and how-it-works without console errors", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Highlight any line");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ask it anything.");
    await expect(page.getByLabel("Article link")).toBeVisible();
    await expect(page.getByRole("button", { name: "Read" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Huxley" })).toHaveAttribute("href", "/read/on-a-piece-of-chalk");
    await expect(page.getByRole("link", { name: "Schopenhauer" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Thoreau" })).toBeVisible();
    await expect(page.getByText("How it works")).toBeVisible();
    await expect(page.getByText("Paste a link", { exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test("enables Read for a URL and opens a sample from a chip", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Article link").fill("https://example.com/article");
    await expect(page.getByRole("button", { name: "Read" })).toBeEnabled();
    await page.getByRole("link", { name: "Thoreau" }).click();
    await expect(page).toHaveURL(/\/read\/walden-reading/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Reading");
  });

  test("paste text dialog imports a document and opens the reader", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Paste text" }).click();
    const dialog = page.getByRole("dialog", { name: "Paste text" });
    await dialog.getByLabel("Text to read").fill("# A pasted note\n\nChalk is soft and white.\n\nIt formed beneath an ancient sea.");
    await dialog.getByRole("button", { name: "Read" }).click();
    await expect(page).toHaveURL(/\/read\/a-pasted-note-/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("A pasted note");
    await expect(page.locator(".blk[data-n]")).toHaveCount(2);
  });

  test("theme switch applies data-theme and persists across reload", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Appearance and answers" }).click();
    await page.getByRole("button", { name: "Sepia" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
  });
});
