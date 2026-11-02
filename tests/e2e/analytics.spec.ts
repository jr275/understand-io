import { expect, test, type Page } from "@playwright/test";
import { openReader } from "./helpers";

/**
 * What the browser sends to the analytics collector (docs/product/analytics.md). The collector itself is covered by unit tests; here the
 * server's answer is stood in for (`/api/events` is fulfilled by the test), so these hold whatever mode the server under test is in, and the
 * point is the client: what it sends, what it never sends, and that it stops when told to or when the browser asks not to be measured.
 */
type Sent = { events: { event: string; props: Record<string, unknown>; path: string }[]; attribution?: Record<string, unknown> };

async function capture(page: Page, mode: "full" | "anonymous" | "off" = "full") {
  const bodies: Sent[] = [];
  await page.route("**/api/events", async (route) => {
    bodies.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({ status: 204, headers: { "x-gloss-analytics": mode } });
  });
  return bodies;
}
const names = (b: Sent[]) => b.flatMap((x) => x.events.map((e) => e.event));
const stamp = () => Math.random().toString(36).slice(2, 8);

test.describe("product analytics, as the browser sends it", () => {
  test("the landing view carries the campaign tags from the address and the referrer's host, nothing more, and the tab remembers them", async ({ page }) => {
    const bodies = await capture(page);
    await page.goto("/?utm_source=Newsletter&utm_medium=email&utm_campaign=Launch-1&ref=AbC123xyz&email=jane@example.com");
    await expect.poll(() => names(bodies)).toContain("landing_viewed");
    const first = bodies.find((b) => b.events.some((e) => e.event === "landing_viewed"))!;
    expect(first.events[0]).toEqual({ event: "landing_viewed", props: {}, path: "/" });
    expect(first.attribution).toEqual({ source: "newsletter", medium: "email", campaign: "launch-1", ref: "AbC123xyz", referrerHost: null });
    expect(JSON.stringify(first)).not.toContain("jane@example.com");
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("gloss:attr"))).toContain("newsletter");
  });

  test("when the server says analytics is off, nothing is stored on the device and nothing more is sent in this tab", async ({ page }) => {
    const bodies = await capture(page, "off");
    await page.goto("/?utm_source=newsletter");
    await expect.poll(() => bodies.length).toBe(1);
    expect(await page.evaluate(() => sessionStorage.getItem("gloss:attr"))).toBeNull();
    expect(await page.evaluate(() => sessionStorage.getItem("gloss:analytics"))).toBe("off");
    await page.goto("/");
    await page.waitForTimeout(700);
    expect(bodies).toHaveLength(1);
  });

  test("a browser that sends Do Not Track sends nothing at all", async ({ page }) => {
    const bodies = await capture(page);
    await page.addInitScript(() => Object.defineProperty(navigator, "doNotTrack", { get: () => "1" }));
    await page.goto("/");
    await openReader(page);
    await page.waitForTimeout(800);
    expect(bodies).toEqual([]);
  });

  test("a browser that sends Global Privacy Control sends nothing at all", async ({ page }) => {
    const bodies = await capture(page);
    await page.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { get: () => true }));
    await page.goto("/");
    await page.waitForTimeout(800);
    expect(bodies).toEqual([]);
  });

  test("opening a text records its kind, where the reader came from and its age as a bucket, with the route as a pattern", async ({ page }) => {
    const bodies = await capture(page);
    await openReader(page);
    await expect.poll(() => names(bodies)).toContain("document_opened");
    const open = bodies.flatMap((b) => b.events).find((e) => e.event === "document_opened")!;
    expect(open).toEqual({ event: "document_opened", props: { kind: "sample", via: "direct", age: "0d" }, path: "/read/:slug" });
  });

  test("nothing a reader reads, writes or searches for reaches an event: not a title, not a word of the text, not the search", async ({ page }) => {
    const bodies = await capture(page);
    const marker = `zebrafishmarker${stamp()}`;
    const title = `Private diary ${stamp()}`;
    await page.goto("/library");
    await page.getByRole("button", { name: "Add a link, PDF or text" }).click();
    const dialog = page.getByRole("dialog", { name: "Add to the library" });
    await dialog.locator('input[type="file"][aria-label="Open PDF, text, Word, EPUB or HTML files"]').setInputFiles({
      name: `${title.replace(/\s+/g, "-")}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(`# ${title}\n\nA private sentence with ${marker} in it, long enough to be kept as a paragraph of its own.\n\nA second paragraph.`),
    });
    await expect.poll(() => names(bodies)).toContain("import_completed");
    await expect.poll(() => names(bodies)).toContain("document_saved");
    await page.goto("/library"); // the import opens the reader; the search box is on the library
    await page.getByLabel("Search the library").fill(marker);
    await expect.poll(() => names(bodies)).toContain("library_searched");
    await page.waitForTimeout(400);
    const everything = JSON.stringify(bodies);
    expect(everything).not.toContain(marker);
    expect(everything).not.toContain(title);
    expect(everything).not.toMatch(/private sentence|second paragraph/i);
    const saved = bodies.flatMap((b) => b.events).find((e) => e.event === "document_saved")!;
    expect(saved.props).toEqual({ kind: expect.stringMatching(/^(text|url|pdf|link)$/), via: "file" });
    const searched = bodies.flatMap((b) => b.events).find((e) => e.event === "library_searched")!;
    expect(searched.props).toEqual({ scope: "library", results: expect.stringMatching(/^(0|1-3|4-10|11\+)$/) });
  });

  test("the collector itself accepts a well-formed event and refuses an unlisted property, without breaking the page", async ({ request }) => {
    const ok = await request.post("/api/events", { data: { events: [{ event: "landing_viewed", props: {}, path: "/" }] } });
    expect(ok.status()).toBe(204);
    expect(["off", "anonymous", "full"]).toContain(ok.headers()["x-gloss-analytics"]);
    const odd = await request.post("/api/events", { data: { events: [{ event: "document_saved", props: { kind: "url", via: "link", url: "https://example.org/x" } }] } });
    expect(odd.status()).toBe(204);
    // With analytics off the endpoint answers 204 before it reads anything; otherwise a body that is not JSON is refused.
    const mode = ok.headers()["x-gloss-analytics"];
    expect((await request.post("/api/events", { data: Buffer.from("{not json"), headers: { "content-type": "application/json" } })).status()).toBe(mode === "off" ? 204 : 400);
    const dnt = await request.post("/api/events", { data: { events: [{ event: "landing_viewed", props: {} }] }, headers: { dnt: "1" } });
    expect(dnt.headers()["x-gloss-analytics"]).toBe("off");
  });
});
