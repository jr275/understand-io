import { expect, test } from "@playwright/test";

// SEC-8 (CSRF guard in src/proxy.ts) and SEC-9 (security headers from next.config.ts).
// POST /api/search without a key answers 402 and writes nothing, so it is a side-effect-free way to see whether the proxy let a request through.
const probe = (request: import("@playwright/test").APIRequestContext, headers: Record<string, string>, method: "POST" | "PUT" | "PATCH" | "DELETE" = "POST") =>
  request.fetch("/api/search", { method, headers: { "x-gloss-key": "", "content-type": "application/json", ...headers }, data: { q: "x", passages: [] } });

test.describe("CSRF guard on /api", () => {
  test("refuses state-changing requests that say they come from another site", async ({ request }) => {
    const cases: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { origin: "null" },
      { origin: "http://localhost.evil.example" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "same-origin", origin: "https://evil.example" }, // the headers must agree
    ];
    for (const headers of cases) {
      const res = await probe(request, headers);
      expect(res.status(), JSON.stringify(headers)).toBe(403);
      expect((await res.json()).error).toBe("forbidden");
    }
    for (const method of ["PUT", "PATCH", "DELETE"] as const) expect((await probe(request, { origin: "https://evil.example" }, method)).status(), method).toBe(403);
  });

  test("lets through same-origin browsers and clients that send neither header (curl, Playwright, server-to-server)", async ({ request, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const allowed: Record<string, string>[] = [{}, { origin }, { "sec-fetch-site": "same-origin", origin }, { "sec-fetch-site": "none" }];
    for (const headers of allowed) {
      const res = await probe(request, headers);
      expect(res.status(), JSON.stringify(headers)).not.toBe(403);
    }
  });

  test("does not touch reads, and the cross-site refusal covers multipart endpoints too", async ({ request }) => {
    expect((await request.get("/api/gloss", { headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } })).status()).toBe(200);
    const form = { multipart: { audio: { name: "speech.webm", mimeType: "audio/webm", buffer: Buffer.from("x") } }, headers: { origin: "https://evil.example" } };
    expect((await request.post("/api/speech/transcribe", form)).status()).toBe(403);
    expect((await request.post("/api/import/file", { multipart: { file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") } }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
  });

  test("a real same-origin fetch from a page still works", async ({ page }) => {
    await page.goto("/");
    const status = await page.evaluate(async () => (await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json", "x-gloss-key": "" }, body: JSON.stringify({ q: "x", passages: [] }) })).status);
    expect(status).not.toBe(403);
  });

  test("uploads larger than Next's default 10 MB proxy buffer reach the route intact", async ({ request }) => {
    // With a proxy file Next buffers the body and truncates it at proxyClientMaxBodySize (10 MB by default); a truncated multipart body
    // fails to parse ("No file received", 400). A broken 12 MB PDF parses as a form and is then refused as a PDF (422), writing nothing.
    const res = await request.post("/api/import/file", { multipart: { file: { name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(12 * 1024 * 1024, 0x41) } } });
    expect(res.status()).toBe(422);
    expect((await res.json()).error).toMatch(/could not be opened/);
  });
});

test.describe("security headers", () => {
  const expectHeaders = (h: Record<string, string>) => {
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toBe("microphone=(self), camera=(), geolocation=()");
    expect(h["content-security-policy"]).toBe("frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["content-security-policy"]).not.toContain("script-src");
    expect(h["strict-transport-security"]).toBeUndefined(); // production only; the dev server runs on plain http
  };

  test("pages and API responses carry them", async ({ page, request }) => {
    const res = await page.goto("/");
    expectHeaders(res!.headers());
    expectHeaders((await page.goto("/read/on-a-piece-of-chalk"))!.headers());
    expectHeaders((await request.get("/api/gloss")).headers());
  });

  test("the app still renders and runs under them (microphone feature policy, inline theme script, forms)", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto("/");
    await expect(page.getByLabel("Article link")).toBeVisible();
    await page.getByLabel("Article link").fill("example.org/post");
    await expect(page.getByRole("button", { name: "Read" })).toBeEnabled();
    expect(errors.filter((e) => /Content Security Policy|Permissions-Policy/i.test(e))).toEqual([]);
  });

  test("it cannot be framed", async ({ page, baseURL }) => {
    await page.setContent(`<iframe id="f" src="${baseURL}/" style="width:600px;height:400px"></iframe>`);
    // A blocked frame never gets a document from the app: its own content is the browser's error page, not the landing page.
    await page.waitForTimeout(1500);
    const framed = page.frame({ url: /localhost:\d+\/$/ });
    const text = framed ? await framed.evaluate(() => document.body?.innerText ?? "").catch(() => "") : "";
    expect(text).not.toContain("Highlight any line");
  });

  test("article images are fetched without a Referer", async ({ page }) => {
    await page.route("https://img.example/**", (r) => r.fulfill({ status: 200, contentType: "image/gif", body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64") }));
    const html = `<!doctype html><html><head><title>Figure test ${Date.now()}</title></head><body><article><h1>Figure test ${Date.now()}</h1><figure><img src="https://img.example/fig.gif" alt="a figure"></figure>${"<p>Chalk is a soft white porous sedimentary carbonate rock composed of the mineral calcite.</p>".repeat(5)}</article></body></html>`;
    const res = await page.request.post("/api/import/page", { data: { url: "https://figure.example/a", html } });
    const j = await res.json();
    test.skip(!j.persisted, "no DATABASE_URL: the reader page cannot load a server document");
    try {
      await page.goto(`/read/${j.document.slug}`);
      const img = page.locator("img.fig-img");
      await expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
    } finally {
      await page.request.delete(`/api/documents/${j.document.id}`); // remove the row this test created
    }
  });
});
