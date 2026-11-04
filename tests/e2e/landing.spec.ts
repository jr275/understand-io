import { expect, test } from "@playwright/test";
import { collectErrors } from "./helpers";
import { bookmarklet } from "../../src/lib/client/bookmarklet";

test.describe("landing", () => {
  test("renders the hero, import bar, samples and how-it-works without console errors", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Highlight any line");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Ask it anything.");
    await expect(page.getByLabel("Article link")).toBeVisible();
    // The button is never greyed out: with nothing typed it takes the reader to the field instead.
    await page.getByRole("button", { name: "Read" }).click();
    await expect(page.getByLabel("Article link")).toBeFocused();
    await expect(page.getByRole("link", { name: "Huxley" })).toHaveAttribute("href", "/read/on-a-piece-of-chalk");
    await expect(page.getByRole("link", { name: "Schopenhauer" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Thoreau" })).toBeVisible();
    await expect(page.getByText("How it works")).toBeVisible();
    await expect(page.getByText("Paste a link", { exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test("the top bar carries no partner logo on any page", async ({ page }) => {
    for (const path of ["/", "/library", "/read/on-a-piece-of-chalk"]) {
      await page.goto(path);
      const banner = page.getByRole("banner");
      await expect(banner.getByRole("link", { name: /Understand\.io/ })).toBeVisible();
      await expect(banner.locator('a[href*="together.ai"], [aria-label="Together AI"]')).toHaveCount(0);
      await expect(banner.getByText("together.ai")).toHaveCount(0);
    }
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

  test("a refused import (too many in a short time) tells the reader why, in words, and keeps the text they typed", async ({ page }) => {
    await page.route("**/api/import/text", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        headers: { "retry-after": "240" },
        body: JSON.stringify({ error: "That is more than 60 imports in 10 minutes. Try again in about 4 minutes.", code: "rate-limited" }),
      }),
    );
    await page.goto("/");
    await page.getByRole("button", { name: "Paste text" }).click();
    const dialog = page.getByRole("dialog", { name: "Paste text" });
    await dialog.getByLabel("Text to read").fill("A note that must not be lost.\n\nSecond paragraph.");
    await dialog.getByRole("button", { name: "Read" }).click();
    await expect(dialog.getByText(/more than 60 imports in 10 minutes\. Try again in about 4 minutes/)).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(dialog.getByLabel("Text to read")).toHaveValue(/A note that must not be lost/);
  });

  test("theme switch applies data-theme and persists across reload", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Appearance and answers" }).click();
    await page.getByRole("button", { name: "Sepia" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "sepia");
  });

  // SEC-7: the capture receiver now checks that what the opener posts comes from the origin of the page it claims to have
  // captured. The old version of this test posted "https://blocked.example/essay" from the Understand origin itself, which is
  // exactly the forgery the check refuses, so the article tab is now a real cross-origin page (mocked at blocked.example)
  // running the real bookmarklet code.
  const ARTICLE = `<!doctype html><html><head><title>Handed over</title></head><body><article><h1>Handed over</h1>${"<p>The page was captured in the browser and handed to Understand through a message, so no server fetch was needed.</p>".repeat(3)}</article></body></html>`;

  test("bookmarklet capture: the article tab posts its HTML and the reader opens", async ({ page, context, baseURL }) => {
    await context.route("https://blocked.example/**", (route) => route.fulfill({ contentType: "text/html", body: ARTICLE }));
    await page.goto("https://blocked.example/essay");
    const popupPromise = context.waitForEvent("page");
    await page.evaluate((code) => new Function(code)(), bookmarklet(new URL(baseURL!).origin, "read").slice("javascript:".length));
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/read\/handed-over/, { timeout: 15000 });
    await expect(popup.getByRole("heading", { level: 1 })).toHaveText("Handed over");
    await expect(popup.locator(".blk[data-n]")).toHaveCount(3);
  });

  test("bookmarklet capture ignores a page that claims to be another site", async ({ page, context, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    await context.route("https://blocked.example/**", (route) => route.fulfill({ contentType: "text/html", body: ARTICLE }));
    await page.goto("https://blocked.example/essay");
    const popupPromise = context.waitForEvent("page");
    await page.evaluate(
      ({ o, html }) => {
        const w = window.open(o + "/?capture=read&url=" + encodeURIComponent("https://blocked.example/essay"))!;
        addEventListener("message", (e) => {
          if (e.source !== w || e.data !== "understand:ready") return;
          // Forged provenance: this page lives on blocked.example but says it saved a nytimes.com article.
          w.postMessage({ type: "understand:page", url: "https://www.nytimes.com/2026/forged-story", title: "Forged", html }, o);
        });
      },
      { o: origin, html: ARTICLE },
    );
    const popup = await popupPromise;
    const imports: string[] = [];
    popup.on("request", (r) => r.url().includes("/api/import") && imports.push(r.url()));
    await popup.waitForLoadState("domcontentloaded");
    await popup.waitForTimeout(2500);
    expect(imports).toEqual([]);
    expect(popup.url()).toContain("capture=read");
    await expect(popup.getByLabel("Article link")).not.toHaveValue(/nytimes/);
  });

  test("/?url= and /?save= only fill the field: nothing is fetched or imported until Read is pressed", async ({ page }) => {
    // SEC-6: these links used to start an import on page load, so any site could make this server fetch a page for the visitor.
    // Before this change the test below failed: /api/import was called within a second of loading.
    const calls: string[] = [];
    await page.route("**/api/import**", (route) => {
      calls.push(route.request().url());
      return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "stubbed" }) });
    });
    for (const q of ["url", "save"]) {
      await page.goto(`/?${q}=${encodeURIComponent("https://example.org/an-article")}`);
      await expect(page.getByLabel("Article link")).toHaveValue("https://example.org/an-article");
      await page.waitForTimeout(1500);
      expect(calls, q).toEqual([]);
    }
    await page.getByRole("button", { name: "Read" }).click();
    await expect.poll(() => calls.length).toBe(1);
  });

  test("/?capture= opened without an opener behaves like a plain link: no import, field filled", async ({ page }) => {
    const calls: string[] = [];
    await page.route("**/api/import**", (route) => {
      calls.push(route.request().url());
      return route.abort();
    });
    await page.goto(`/?capture=read&url=${encodeURIComponent("https://example.org/an-article")}`);
    await expect(page.getByLabel("Article link")).toHaveValue("https://example.org/an-article");
    await expect(page.getByLabel("Article link")).toBeEnabled();
    await page.waitForTimeout(7000); // longer than the capture wait: the old fallback fetched the page on the server here
    expect(calls).toEqual([]);
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
    // The paint entry is added when the browser paints, which on a fast production build can be just after the load event.
    // Firefox and WebKit do not report "first-paint", only "first-contentful-paint", which is never earlier: the order checked below holds for either.
    await page.waitForFunction(() => performance.getEntriesByType("paint").some((p) => p.name === "first-paint" || p.name === "first-contentful-paint"));
    const timing = await page.evaluate(() => ({
      themeAt: (window as unknown as { __themeAt?: number }).__themeAt,
      firstPaint: (performance.getEntriesByType("paint").find((p) => p.name === "first-paint") ?? performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint"))?.startTime,
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
