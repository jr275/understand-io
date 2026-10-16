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

  test("url import rejects private hosts and bad input", async ({ request }) => {
    expect((await request.post("/api/import", { data: { url: "http://127.0.0.1:3100/" } })).status()).toBe(400);
    expect((await request.post("/api/import", { data: { url: "nope" } })).status()).toBe(400);
  });

  test("search endpoint without key is explicit", async ({ request }) => {
    const res = await request.post("/api/search", { headers: { "x-gloss-key": "" }, data: { q: "chalk", passages: [{ key: "a", text: "chalk" }] } });
    expect([402, 200]).toContain(res.status());
  });
});
