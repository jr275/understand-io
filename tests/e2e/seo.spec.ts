import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * What a search engine or a social card sees: the head of each kind of page, robots.txt and the sitemap. Canonical and hreflang addresses need the
 * public origin (`APP_URL`), which the test server does not have; they are covered by tests/unit/seoRoutes.test.ts, which sets it.
 */
// Not `head meta`: a production build streams metadata to a browser (it may arrive in the body) and puts it in the head only for crawlers.
const meta = (page: Page, sel: string) => page.locator(`meta[${sel}]`).first().getAttribute("content");

/** True when the server under test is a production build (the dev server answers `development`). */
const isProductionBuild = async (request: APIRequestContext) => ((await (await request.get("/api/health")).json()) as { environment?: string }).environment === "production";

test.describe("search and social presentation", () => {
  test("the landing page has its own title, description and social card, and structured data that claims no rating or price", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Keeple.me: highlight any line and ask it anything");
    expect(await meta(page, 'name="description"')).toMatch(/margin/);
    expect(await meta(page, 'property="og:title"')).toBe("Keeple.me: highlight any line and ask it anything");
    expect(await meta(page, 'property="og:site_name"')).toBe("Keeple.me");
    expect(await meta(page, 'name="twitter:card"')).toBe("summary_large_image");
    expect(await meta(page, 'property="og:image"')).toContain("/opengraph-image");
    expect(await page.locator("meta[name=robots][content*=noindex]").count()).toBe(0);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
    expect(ld).toMatchObject({ "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Keeple.me" });
    expect(ld).not.toHaveProperty("aggregateRating");
    expect(ld).not.toHaveProperty("offers");
  });

  test("the social card image is served as a PNG", async ({ request }) => {
    const res = await request.get("/opengraph-image");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });

  test("robots.txt keeps crawlers out of the API and the library, and sitemap.xml is valid XML", async ({ request }) => {
    const robots = await (await request.get("/robots.txt")).text();
    expect(robots).toContain("User-Agent: *");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toContain("Disallow: /library");
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/xml/);
    const xml = await res.text();
    expect(xml).toContain("<urlset");
    expect(xml).not.toMatch(/\/library|\/api\//);
  });

  test("the library says noindex", async ({ page }) => {
    await page.goto("/library");
    expect(await meta(page, 'name="robots"')).toMatch(/noindex/);
  });

  test("a bundled sample can be found and has its own description; a reader's own text cannot", async ({ page }) => {
    await page.goto("/read/on-a-piece-of-chalk");
    await expect(page).toHaveTitle("On a Piece of Chalk, glossed");
    expect(await meta(page, 'name="description"')).toMatch(/Huxley[\s\S]*margin/);
    expect(await page.locator("meta[name=robots][content*=noindex]").count()).toBe(0);

    const saved = await page.request.post("/api/import/text", { data: { text: `A private note that is nobody else's business.\n\nSecond paragraph of it, long enough to count.`, title: "Private thing" } });
    const slug = (await saved.json()).document.slug as string;
    await page.goto(`/read/${slug}`);
    expect(await meta(page, 'name="robots"')).toMatch(/noindex/);
    // The site-wide card is all a crawler could ever get: the text's own title is in no social tag.
    expect((await meta(page, 'property="og:title"')) ?? "").not.toContain("Private thing");
    expect((await meta(page, 'name="description"')) ?? "").not.toContain("nobody else");
  });

  test("a learn page that is still a draft: a 404 in production, previewable in development, noindex either way, and its demonstration opens a real text", async ({ page, request }) => {
    if (await isProductionBuild(request)) {
      // Nothing is published until the owner says so (GLOSS_LEARN_PREVIEW shows drafts, and the test server does not set it).
      expect((await request.get("/learn/ai-pdf-reader")).status()).toBe(404);
      return;
    }
    await page.goto("/learn/ai-pdf-reader");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("AI PDF reader");
    await expect(page).toHaveTitle("An AI PDF reader that answers in the margin");
    expect(await meta(page, 'name="robots"')).toMatch(/noindex/);
    await page.getByTestId("learn-demo").click();
    await expect(page).toHaveURL(/\/read\/on-a-piece-of-chalk$/);
    await expect(page.locator(".prose-read .blk").first()).toBeVisible();
  });

  test("a learn page that does not exist is a 404", async ({ request }) => {
    expect((await request.get("/learn/no-such-page")).status()).toBe(404);
  });
});
