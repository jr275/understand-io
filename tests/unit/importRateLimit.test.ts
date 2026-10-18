import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importLimit, limitImports, resetRateLimits } from "@/lib/server/rateLimit";

const req = (ip: string, cookie?: string) => new Request("http://localhost/api/import/text", { method: "POST", headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}) } });

describe("import rate limit", () => {
  const saved = process.env.GLOSS_RATE_IMPORT;
  beforeEach(() => {
    resetRateLimits();
    delete process.env.GLOSS_RATE_IMPORT;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.GLOSS_RATE_IMPORT;
    else process.env.GLOSS_RATE_IMPORT = saved;
  });

  it("allows 60 imports per ten minutes by default, then answers 429 with a wait", async () => {
    expect(importLimit()).toEqual({ max: 60, windowMs: 600_000 });
    for (let i = 0; i < 60; i++) expect(limitImports(req("203.0.113.5"))).toBeNull();
    const blocked = limitImports(req("203.0.113.5"));
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(blocked?.headers.get("cache-control")).toBe("no-store");
    const body = await blocked!.json();
    expect(body.code).toBe("rate-limited");
    expect(body.error).toMatch(/60 imports in 10 minutes.*Try again in about/);
  });

  it("counts each client address separately", () => {
    process.env.GLOSS_RATE_IMPORT = "2";
    expect(limitImports(req("203.0.113.1"))).toBeNull();
    expect(limitImports(req("203.0.113.1"))).toBeNull();
    expect(limitImports(req("203.0.113.1"))?.status).toBe(429);
    expect(limitImports(req("203.0.113.2"))).toBeNull();
  });

  it("can be raised, and switched off", () => {
    process.env.GLOSS_RATE_IMPORT = "5";
    expect(importLimit()?.max).toBe(5);
    process.env.GLOSS_RATE_IMPORT = "off";
    expect(importLimit()).toBeNull();
    for (let i = 0; i < 200; i++) expect(limitImports(req("203.0.113.9"))).toBeNull();
  });

  it("ignores a nonsense setting rather than disabling the limit", () => {
    process.env.GLOSS_RATE_IMPORT = "lots";
    expect(importLimit()?.max).toBe(60);
    process.env.GLOSS_RATE_IMPORT = "-3";
    expect(importLimit()?.max).toBe(60);
  });
});
