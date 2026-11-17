// LIVENESS (GET /api/health): whatever the request carries, it must never reach the database, the store or the provider. Everything that could is
// replaced below by something that fails the test loudly if it is touched.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GET } from "@/app/api/health/route";
import { liveness, resetHealthLimits } from "@/lib/server/readiness";

const touched = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    touched.n++;
    throw new Error("liveness touched the database client");
  },
}));
vi.mock("@/lib/server/aiStore", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/aiStore")>()),
  aiStore: () => {
    touched.n++;
    throw new Error("liveness touched the store");
  },
}));
vi.mock("@/lib/server/healthProbe", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/healthProbe")>()),
  probe: () => {
    touched.n++;
    throw new Error("liveness asked for a database reading");
  },
}));

beforeEach(() => {
  touched.n = 0;
  resetHealthLimits();
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", "postgres://u:p@127.0.0.1:1/never"); // configured, and unreachable: any attempt to use it would hang or fail
  vi.stubEnv("GLOSS_HEALTH_TOKEN", "t".repeat(40));
});

const call = (qs = "", headers: Record<string, string> = {}, ip = "198.51.100.7") => GET(new Request(`http://x.test/api/health${qs}`, { headers: { "x-forwarded-for": ip, ...headers } }));

describe("GET /api/health (liveness)", () => {
  it("answers ok with the commit and the environment, and nothing about the database, the AI or the storage", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef");
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await call();
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Object.keys(j).sort()).toEqual(["check", "commit", "environment", "region", "status", "time"]);
    expect(j).toMatchObject({ status: "ok", check: "liveness", commit: "0123456", environment: "production" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(touched.n).toBe(0);
  });

  it("holds no secret, whatever the environment holds", async () => {
    vi.stubEnv("TOGETHER_API_KEY", "sk-must-never-appear");
    vi.stubEnv("GLOSS_COOKIE_SECRET", "cookie-secret-must-never-appear-1234567890");
    const text = await (await call()).text();
    expect(text).not.toMatch(/must-never-appear|postgres:|127\.0\.0\.1|t{40}/);
  });

  it("is unaffected by a database that cannot be reached: it answers at once", async () => {
    const t0 = performance.now();
    const res = await call();
    expect(res.status).toBe(200);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(touched.n).toBe(0);
  });

  it("ignores every query parameter and header that might be taken for a request to look deeper", async () => {
    const variants: [string, Record<string, string>][] = [
      ["?fresh=1", {}],
      ["?strict=1", {}],
      ["?fresh=1&strict=1", {}],
      ["?fresh=1&fresh=1", {}],
      ["?FRESH=1", {}],
      ["?fresh[]=1", {}],
      ["?fresh=true", {}],
      ["?%66resh=1", {}],
      ["?deep=1&db=1&ready=1&check=readiness", {}],
      ["", { "cache-control": "no-cache" }],
      ["", { pragma: "no-cache", "x-vercel-cache-bypass": "1" }],
      ["", { authorization: `Bearer ${"t".repeat(40)}` }], // even the readiness token does not make liveness look at the database
      ["?fresh=1", { authorization: `Bearer ${"t".repeat(40)}`, "cache-control": "no-cache" }],
    ];
    for (const [qs, headers] of variants) {
      const res = await call(qs, headers);
      expect(res.status, qs).toBe(200);
      expect((await res.json()).check, qs).toBe("liveness");
    }
    expect(touched.n).toBe(0);
  });

  it("two thousand concurrent calls reach neither the database nor the store, and finish at once", async () => {
    vi.stubEnv("GLOSS_HEALTH_RATE_PER_MIN", "off");
    const t0 = performance.now();
    const answers = await Promise.all(Array.from({ length: 2000 }, (_, i) => call(i % 2 ? "?fresh=1" : "", {}, `203.0.113.${i % 250}`)));
    expect(answers.every((r) => r.status === 200)).toBe(true);
    expect(touched.n).toBe(0);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("the route file itself imports nothing that can reach a database (a guard against a later edit)", () => {
    for (const f of ["src/app/api/health/route.ts"]) {
      const text = readFileSync(f, "utf8");
      const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      expect(imports, f).toEqual(["@/lib/server/readiness"]);
      expect(text).not.toMatch(/aiStore|getDb|healthProbe|probe\(|drizzle|postgres|DATABASE_URL/);
    }
    const src = readFileSync("src/lib/server/readiness.ts", "utf8");
    const live = src.slice(src.indexOf("export function liveness"), src.indexOf("export async function readiness"));
    expect(live).not.toMatch(/aiStore|getDb|probe\(|DATABASE_URL|await/);
  });
});

describe("the limit on liveness (a guard on invocations, never on the database)", () => {
  it("answers 429 with retry-after past the per-address limit, and only for that address", () => {
    vi.stubEnv("GLOSS_HEALTH_RATE_PER_MIN", "5");
    const req = (ip: string) => new Request("http://x.test/api/health", { headers: { "x-forwarded-for": ip } });
    const t = Date.UTC(2026, 10, 3, 12);
    const first = Array.from({ length: 5 }, () => liveness(req("192.0.2.1"), t).status);
    expect(first).toEqual([200, 200, 200, 200, 200]);
    const sixth = liveness(req("192.0.2.1"), t + 1000);
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(liveness(req("192.0.2.2"), t + 1000).status).toBe(200);
    expect(liveness(req("192.0.2.1"), t + 61_000).status).toBe(200); // the window slides
    expect(touched.n).toBe(0);
  });

  it("allows 600 a minute by default, which no monitor, deploy check or startup poll approaches", () => {
    const t = Date.UTC(2026, 10, 3, 12);
    const r = () => liveness(new Request("http://x.test/api/health", { headers: { "x-forwarded-for": "192.0.2.9" } }), t).status;
    const answers = Array.from({ length: 601 }, r);
    expect(answers.slice(0, 600).every((s) => s === 200)).toBe(true);
    expect(answers[600]).toBe(429);
  });

  it("can be switched off", () => {
    vi.stubEnv("GLOSS_HEALTH_RATE_PER_MIN", "off");
    for (let i = 0; i < 1500; i++) expect(liveness(new Request("http://x.test/api/health", { headers: { "x-forwarded-for": "192.0.2.5" } })).status).toBe(200);
  });
});
