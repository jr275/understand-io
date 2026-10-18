import { expect, test } from "@playwright/test";

/**
 * Saving every kind of link. The links used here point at private addresses on purpose: the server refuses to fetch them, so they are
 * links whose page can never be read, and the tests need no network. The readable path (articles, PDFs, text) is covered by the import specs
 * and by live imports recorded in docs/audit.
 */
const UNREADABLE = "http://127.0.0.1/reports/annual-report";

test.describe("a link is always saved", () => {
  test("API: keep saves an unreadable link as a link card and says why; without keep the old answer stays", async ({ request }) => {
    const refused = await request.post("/api/import", { data: { url: UNREADABLE } });
    expect(refused.status()).toBe(400);
    const kept = await request.post("/api/import", { data: { url: UNREADABLE, keep: true } });
    expect(kept.status()).toBe(200);
    const j = await kept.json();
    expect(j.linkOnly).toBe(true);
    expect(j.reason).toMatch(/public links/i);
    expect(j.document).toMatchObject({ kind: "link", sourceUrl: UNREADABLE, title: "127.0.0.1: annual report", paragraphs: 0 });
    expect(j.document.blocks[0]).toMatchObject({ id: "reason" });
  });

  test("API: credentials typed into the address are not kept; addresses that are not web links are still refused", async ({ request }) => {
    const j = await (await request.post("/api/import", { data: { url: "http://someone:secret-password@127.0.0.1/page", keep: true } })).json();
    expect(j.document.sourceUrl).toBe("http://127.0.0.1/page");
    expect(JSON.stringify(j)).not.toContain("secret-password");
    for (const url of ["ftp://example.com/file", "javascript:alert(1)", "file:///etc/passwd"]) {
      const r = await request.post("/api/import", { data: { url, keep: true } });
      expect(r.status(), url).toBe(400);
    }
  });

  test("the landing page saves an unreadable link, says so, and opens its page with the reason and the ways forward", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Article link").fill(UNREADABLE);
    await page.getByRole("button", { name: /^Read/ }).click();
    await expect(page.locator("[data-link-page]")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("127.0.0.1: annual report");
    await expect(page.getByRole("note")).toContainText("public links");
    await expect(page.getByRole("link", { name: /Open the original/ })).toHaveAttribute("href", UNREADABLE);
    await expect(page.getByRole("region", { name: "Ways to read it here" })).toContainText("bookmarklet");
    await expect(page.getByText(/Saved the link/)).toBeVisible();
    // It is on the shelf.
    await page.goto("/library");
    await expect(page.locator("button.bk")).toHaveCount(4);
    await page.locator("button.bk", { hasText: "127.0.0.1" }).click();
    const dialog = page.getByRole("dialog", { name: /127\.0\.0\.1/ });
    await expect(dialog).toContainText("saved link");
    await expect(dialog.getByRole("button", { name: /Open the link/ })).toBeVisible();
  });

  test("Try reading it again keeps the card when it still cannot be read, and Remove takes it off the shelf", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Article link").fill("http://127.0.0.1/again");
    await page.getByRole("button", { name: /^Read/ }).click();
    await expect(page.locator("[data-link-page]")).toBeVisible();
    await page.getByRole("button", { name: "Try reading it again" }).click();
    await expect(page.getByText(/public links/i).first()).toBeVisible();
    await expect(page.locator("[data-link-page]")).toBeVisible(); // still the card
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.locator("button.bk")).toHaveCount(3);
  });

  test("several links at once: each is saved, and the unreadable ones say so", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("button", { name: /Add articles/ }).click();
    await page.getByLabel("Links to save").fill("http://127.0.0.1/one\nhttp://127.0.0.1/two");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const rows = page.locator(".add-rows li");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute("data-state", "saved");
    await expect(rows.first()).toContainText("Saved as a link");
    await expect(rows.last()).toHaveAttribute("data-state", "saved");
  });
});
