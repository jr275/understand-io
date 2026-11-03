import { expect, test } from "@playwright/test";
import { collectErrors } from "./helpers";

test.describe("library", () => {
  test("shows the sample spines, stats, filters and opens a book", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/library");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your library");
    await expect(page.locator("button.bk")).toHaveCount(3);
    await expect(page.getByText(/3 texts/)).toBeVisible();
    // The accessible name starts with exactly the words printed on the spine (title, then short author), so
    // voice-control users can say what they see (WCAG 2.5.3 Label in Name).
    const spine = page.getByRole("button", { name: "On a Piece of Chalk Huxley" });
    await expect(spine).toHaveText(/On a Piece of Chalk\s+Huxley/);
    await spine.click();
    const dialog = page.getByRole("dialog", { name: "On a Piece of Chalk" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Start reading")).toBeVisible();
    await dialog.getByRole("button", { name: /Put it back/ }).click();
    await expect(dialog).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
  });

  test("topic chips filter the shelf and the topics view lists topics", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("button", { name: /Science/ }).first().click();
    await expect(page.locator("button.bk")).toHaveCount(1);
    await page.getByRole("button", { name: /^All/ }).click();
    await expect(page.locator("button.bk")).toHaveCount(3);
    await page.getByRole("radio", { name: "Topics" }).click();
    await expect(page.locator(".topic-card")).toHaveCount(3);
    await page.locator(".topic-card").first().click();
    await expect(page.locator("button.bk")).toHaveCount(1);
  });

  test("search narrows the shelf; the add panel opens with bookmarklets", async ({ page }) => {
    await page.goto("/library");
    await page.keyboard.press("/");
    await page.getByLabel("Search the library").fill("thoreau");
    await expect(page.locator("button.bk")).toHaveCount(1);
    await page.getByLabel("Search the library").fill("");
    await page.getByRole("button", { name: /Add a source/ }).click();
    const dialog = page.getByRole("dialog", { name: "Add to the library" });
    await expect(dialog.getByText("Read in Understand")).toBeVisible();
    await dialog.getByText("Several links at once").click();
    await dialog.getByLabel("Links to save").fill("not a url");
    await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });
});
