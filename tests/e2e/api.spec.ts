import { expect, test } from "@playwright/test";

test.describe("api", () => {
  test("gloss endpoint refuses honestly without a key", async ({ request }) => {
    const res = await request.post("/api/gloss", {
      headers: { "x-gloss-key": "" },
      data: { title: "T", action: "explain", anchor: null, context: [{ id: "p1", n: 1, text: "x" }] },
    });
    const status = res.status();
    const body = await res.json();
    if (status === 402) expect(body.error).toBe("needs-key");
    else test.info().annotations.push({ type: "note", description: `server key configured; gloss returned ${status}` });
  });

  test("text import creates a readable document owned by the same browser", async ({ page }) => {
    // page.request shares the browser's cookie jar, so the reader cookie matches.
    const res = await page.request.post("/api/import/text", { data: { text: "# Imported\n\nOne paragraph.\n\nTwo paragraph." } });
    expect(res.ok()).toBeTruthy();
    const j = await res.json();
    expect(j.document.title).toBe("Imported");
    expect(j.document.blocks).toHaveLength(2);
    if (j.persisted) {
      await page.goto(`/read/${j.document.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Imported");
    } else test.info().annotations.push({ type: "note", description: "no DATABASE_URL: server did not persist" });
  });

  test("page import reads HTML captured in the browser without fetching the site", async ({ page }) => {
    const html = `<!doctype html><html><head><title>Captured</title></head><body><article><h1>Captured</h1>${"<p>Chalk is a soft white limestone made of the shells of tiny sea creatures that lived long ago.</p>".repeat(4)}</article></body></html>`;
    const res = await page.request.post("/api/import/page", { data: { url: "https://www.theatlantic.com/blocked/article", html, title: "Captured" } });
    expect(res.ok()).toBeTruthy();
    const j = await res.json();
    expect(j.document.title).toBe("Captured");
    expect(j.document.sourceUrl).toBe("https://www.theatlantic.com/blocked/article");
    expect(j.document.blocks.length).toBeGreaterThanOrEqual(4);
    expect((await page.request.post("/api/import/page", { data: { url: "https://x.test/", html: "<p>short</p>" } })).status()).toBe(422);
    expect((await page.request.post("/api/import/page", { data: { url: "nope", html: "<p>x</p>" } })).status()).toBe(400);
  });

  test("url import rejects private hosts and bad input", async ({ request }) => {
    expect((await request.post("/api/import", { data: { url: "http://127.0.0.1:3100/" } })).status()).toBe(400);
    expect((await request.post("/api/import", { data: { url: "nope" } })).status()).toBe(400);
  });

  test("search endpoint without key is explicit", async ({ request }) => {
    const res = await request.post("/api/search", { headers: { "x-gloss-key": "" }, data: { q: "chalk", passages: [{ key: "a", text: "chalk" }] } });
    expect([402, 200]).toContain(res.status());
  });

  test("sign-in is honest about its configuration", async ({ request }) => {
    const me = await request.get("/api/auth/me");
    expect(me.ok()).toBeTruthy();
    const j = await me.json();
    expect(j.account).toBeNull();
    if (!j.configured) {
      const start = await request.get("/api/auth/google", { maxRedirects: 0 });
      expect(start.status()).toBe(503);
      expect((await start.json()).error).toBe("not-configured");
    } else test.info().annotations.push({ type: "note", description: "Google sign-in configured on this server" });
    // Sign-out is always safe to call.
    expect((await request.post("/api/auth/signout")).status()).toBe(204);
  });
});
