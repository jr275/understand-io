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

  test("bookmarklet capture: the opener tab posts its HTML and the reader opens", async ({ page, context }) => {
    await page.goto("/library");
    // Simulate the article tab: run the bookmarklet's logic against this origin.
    const popupPromise = context.waitForEvent("page");
    await page.evaluate(() => {
      const o = location.origin;
      const w = window.open(o + "/?capture=read&url=" + encodeURIComponent("https://blocked.example/essay"));
      addEventListener("message", (e) => {
        if (e.source !== w || e.data !== "understand:ready") return;
        const html = `<!doctype html><html><head><title>Handed over</title></head><body><article><h1>Handed over</h1>${"<p>The page was captured in the browser and handed to Understand through a message, so no server fetch was needed.</p>".repeat(3)}</article></body></html>`;
        w!.postMessage({ type: "understand:page", url: "https://blocked.example/essay", title: "Handed over", html }, o);
      });
    });
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/read\/handed-over/, { timeout: 15000 });
    await expect(popup.getByRole("heading", { level: 1 })).toHaveText("Handed over");
    await expect(popup.locator(".blk[data-n]")).toHaveCount(3);
  });

  test("the Sign in control never pretends: unconfigured servers explain what is missing", async ({ page, request }) => {
    const { configured } = await (await request.get("/api/auth/me")).json();
    await page.goto("/");
    if (configured) {
      await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", /\/api\/auth\/google/);
      return;
    }
    await page.getByRole("button", { name: "Sign in" }).click();
    const pop = page.getByRole("dialog", { name: "Sign in" });
    await expect(pop).toContainText("not set up on this server");
    await expect(pop).toContainText("GOOGLE_CLIENT_ID");
    await page.keyboard.press("Escape");
    await expect(pop).toHaveCount(0);
  });

  test("saved theme is applied before first paint and client navigation logs no console errors", async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      localStorage.setItem("gloss:settings", JSON.stringify({ theme: "night" }));
      const w = window as unknown as { __themeAt?: number };
      const obs = new MutationObserver((ms) => {
        for (const m of ms) if (m.type === "attributes" && m.target === document.documentElement && document.documentElement.dataset.theme === "night" && w.__themeAt === undefined) w.__themeAt = performance.now();
      });
      obs.observe(document, { attributes: true, subtree: true, attributeFilter: ["data-theme"] });
    });
    await page.goto("/");
    const timing = await page.evaluate(() => ({
      themeAt: (window as unknown as { __themeAt?: number }).__themeAt,
      firstPaint: performance.getEntriesByType("paint").find((p) => p.name === "first-paint")?.startTime,
    }));
    // The inline boot script runs while the HTML is parsed, so the dark theme is in place before anything is painted.
    expect(timing.themeAt).toBeDefined();
    expect(timing.firstPaint).toBeDefined();
    expect(timing.themeAt!).toBeLessThan(timing.firstPaint!);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    // Client-side navigation re-renders the root layout; React must not be asked to create a <script> again.
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Library" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your library");
    await page.getByRole("link", { name: "Understand.io, back to your library" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.waitForTimeout(400);
    // Next cancels a superseded <Link> prefetch (`?_rsc=`) when the user navigates away from it; that abort is
    // normal and not an app error. Every console error and page error still counts, including React's script-tag warning.
    const real = errors.filter((e) => !e.includes("favicon") && !/^request failed: \S+[?&]_rsc=/.test(e));
    expect(real).toEqual([]);
  });
});
