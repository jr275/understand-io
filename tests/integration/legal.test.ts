import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The legal pages against the production build, started three ways: publication off (the default), publication on while the texts in
 * docs/legal are still drafts, and publication on with final texts (docs/legal/test-fixtures, chosen with GLOSS_LEGAL_SET). It shows that a draft is never served and that
 * a release of this code changes nothing a reader can see until the operator has switched publication on and the texts are final.
 * Runs wherever there is a build (`.next`); it starts and stops its own servers on ports 3321 to 3323 and needs no database.
 */
const READY = existsSync(".next/BUILD_ID");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Instance {
  port: number;
  proc: ChildProcess;
  log: string[];
}
const running: Instance[] = [];

async function start(port: number, env: Record<string, string>): Promise<Instance> {
  const log: string[] = [];
  const clean = { ...process.env };
  delete clean.GLOSS_LEGAL_PUBLISHED;
  delete clean.GLOSS_LEGAL_SET;
  delete clean.DATABASE_URL; // these pages need none; the app runs in its local-only mode
  const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], {
    env: { ...clean, GLOSS_COOKIE_SECRET: "a-test-secret-that-is-at-least-thirty-two-characters-long", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.on("data", (d) => log.push(String(d)));
  proc.stderr?.on("data", (d) => log.push(String(d)));
  const inst = { port, proc, log };
  running.push(inst);
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).status < 500) return inst;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error(`the server on port ${port} did not start:\n${log.join("").slice(-600)}`);
}

const get = async (i: Instance, path: string) => {
  const res = await fetch(`http://127.0.0.1:${i.port}${path}`);
  return { status: res.status, text: await res.text(), headers: res.headers };
};

describe.skipIf(!READY)("the legal pages (production build)", () => {
  let off: Instance;
  let drafts: Instance;
  let published: Instance;

  beforeAll(async () => {
    [off, drafts, published] = await Promise.all([start(3321, {}), start(3322, { GLOSS_LEGAL_PUBLISHED: "1" }), start(3323, { GLOSS_LEGAL_PUBLISHED: "1", GLOSS_LEGAL_SET: "test-fixtures" })]);
  }, 240_000);

  afterAll(async () => {
    for (const i of running) {
      await new Promise<void>((ok) => {
        i.proc.once("exit", () => ok());
        i.proc.kill("SIGTERM");
        setTimeout(ok, 5000);
      });
    }
  }, 60_000);

  const ROUTES = ["/privacy", "/terms", "/legal/privacy", "/legal/terms", "/legal/ai-notice", "/legal/retention", "/legal/beta", "/privacy?lang=pt", "/terms?lang=pt"];

  it("by default (publication off) none of the pages exists, and no page links to them", async () => {
    for (const r of ROUTES) expect((await get(off, r)).status, r).toBe(404);
    for (const page of ["/", "/library"]) {
      const { status, text } = await get(off, page);
      expect(status).toBe(200);
      expect(text, page).not.toContain('aria-label="Legal"');
      expect(text, page).not.toMatch(/href="\/(privacy|terms)/);
    }
  });

  it("with publication on but the texts still drafts (⚠️ markers left), still none is served, in either language, and the server says why", async () => {
    for (const r of ROUTES) expect((await get(drafts, r)).status, r).toBe(404);
    for (const page of ["/", "/library"]) {
      const { text } = await get(drafts, page);
      expect(text, page).not.toContain('aria-label="Legal"');
      expect(text, page).not.toMatch(/href="\/(privacy|terms)/);
    }
    await sleep(300);
    expect(drafts.log.join("")).toMatch(/\[legal\] .* is not shown: it still has open items/);
  });

  it("with publication on and final texts, the pages are served in both languages, as readable HTML with nothing unsafe", async () => {
    const en = await get(published, "/privacy");
    expect(en.status).toBe(200);
    expect(en.text).toContain("Privacy Policy (test text)");
    expect(en.text).toContain("<title>Privacy Policy</title>");
    expect(en.text).toMatch(/<article[^>]*lang="en"/);
    for (const part of ["<h2", "<table", "<blockquote", "list-disc", "<code"]) expect(en.text, part).toContain(part);
    expect((en.text.match(/<ul/g) ?? []).length).toBeGreaterThanOrEqual(2); // the nested list
    const pt = await get(published, "/privacy?lang=pt");
    expect(pt.status).toBe(200);
    expect(pt.text).toContain("Política de Privacidade (texto de teste)");
    expect(pt.text).toMatch(/<article[^>]*lang="pt-BR"/);
    expect((await get(published, "/terms")).text).toContain("Terms of Use (test text)");
    for (const doc of ["ai-notice", "retention", "beta"]) expect((await get(published, `/legal/${doc}`)).status, doc).toBe(200);
  });

  it("notes for the owner never reach a reader, scripts in the text are only text, and an unsafe link is not a link", async () => {
    const { text } = await get(published, "/privacy");
    expect(text).not.toMatch(/must never reach a reader|NOTE FOR OWNER/);
    expect(text).not.toContain('<script>alert("x")');
    expect(text).toContain("&lt;script&gt;");
    expect(text).not.toMatch(/href="javascript:/);
    expect(text).toContain('href="/terms"');
  });

  it("each page offers the other language and the other texts, and an unknown text is a 404", async () => {
    const { text } = await get(published, "/privacy");
    expect(text).toContain('href="/pt-BR/privacy"'); // the Portuguese text has its own address
    expect(text).toContain('aria-label="Other legal texts"');
    expect(text).toContain('href="/terms"');
    const pt = await get(published, "/pt-BR/privacy");
    expect(pt.status).toBe(200);
    expect(pt.text).toMatch(/<html[^>]*lang="pt-BR"/);
    expect(pt.text).toMatch(/<article[^>]*lang="pt-BR"/);
    expect(pt.text).toContain('aria-label="Outros textos jurídicos"');
    expect(pt.text).toContain('href="/privacy"'); // and links back to the English one
    expect(pt.text).toContain('href="/pt-BR/terms"');
    expect((await get(published, "/legal/not-a-text")).status).toBe(404);
    expect((await get(published, "/legal/..%2Fpackage")).status).toBe(404);
  });

  it("the footer links appear on the landing page and the library, and nowhere in the reader", async () => {
    for (const page of ["/", "/library"]) {
      const { text } = await get(published, page);
      expect(text, page).toContain('aria-label="Legal"');
      expect(text, page).toContain('href="/privacy"');
      expect(text, page).toContain('href="/terms"');
    }
    expect((await get(published, "/read/on-a-piece-of-chalk")).text).not.toContain('aria-label="Legal"');
  });

  it("the pages carry the same security headers as every page", async () => {
    const h = (await get(published, "/privacy")).headers;
    expect(h.get("x-frame-options")).toBe("DENY");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
});
