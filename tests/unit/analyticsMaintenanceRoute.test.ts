// The maintenance endpoint for analytics retention: it must not exist without a long token, must refuse every wrong guess, and must never reveal the
// token, the mode or a row to someone who is not authorised.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/maintenance/analytics-retention/route";
import { resetRetentionState } from "@/lib/server/analyticsRetention";

// These tests use the in-memory store and an injected sink: whatever DATABASE_URL is in the environment, they must never touch a database.
vi.mock("@/lib/db/client", () => ({ getDb: () => null }));

const TOKEN = "t".repeat(20) + "OK" + "9".repeat(22); // 44 characters, a throwaway value for this test only
let nth = 0;
const req = (method: "GET" | "POST", auth?: string, ip?: string) =>
  new Request("http://x.test/api/maintenance/analytics-retention", { method, headers: { ...(auth !== undefined ? { authorization: auth } : {}), "x-forwarded-for": ip ?? `198.51.100.${nth++ % 250}` } });

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  resetRetentionState();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("without a configured token the endpoint does not exist", () => {
  it.each([[undefined], [""], ["short"], ["x".repeat(31)]])("answers 404 to everything when the token is %j, even to a request that sends one", async (token) => {
    if (token !== undefined) vi.stubEnv("GLOSS_MAINTENANCE_TOKEN", token);
    for (const call of [GET, POST]) {
      for (const auth of [undefined, `Bearer ${token ?? ""}`, `Bearer ${TOKEN}`]) {
        const res = await call(req(call === GET ? "GET" : "POST", auth));
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: "not-found" });
      }
    }
  });
});

describe("with a token", () => {
  beforeEach(() => vi.stubEnv("GLOSS_MAINTENANCE_TOKEN", TOKEN));

  it("refuses a request with no credentials, a wrong token, the token without Bearer, and another scheme", async () => {
    for (const auth of [undefined, "Bearer nope", `Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(1)}`, TOKEN, `Basic ${TOKEN}`, "Bearer ", "Bearer", "bearer " + TOKEN]) {
      for (const call of [GET, POST]) {
        const res = await call(req(call === GET ? "GET" : "POST", auth));
        expect(res.status, String(auth)).toBe(401);
        expect(await res.json()).toEqual({ error: "unauthorized" });
      }
    }
  });
  it("treats a guess of any length the same way (no exception from comparing unequal lengths, no hint)", async () => {
    for (const guess of ["a", "a".repeat(5000), "é".repeat(30)]) expect((await GET(req("GET", `Bearer ${guess}`))).status).toBe(401);
  });
  it("does not reveal anything to an unauthorised caller: not the token, not the analytics mode, not a policy", async () => {
    vi.stubEnv("GLOSS_ANALYTICS", "full");
    const body = JSON.stringify(await (await GET(req("GET", "Bearer wrong"))).json());
    expect(body).not.toMatch(/full|policy|expired|cutoff|deleted/i);
    expect(body).not.toContain(TOKEN);
  });
  it("GET with the token says what the policy is and how many rows are overdue, and never the token", async () => {
    const res = await GET(req("GET", `Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body).toMatchObject({ mode: "off", policy: { days: 120, batch: 1000 }, expiredRows: 0, expiredRowsCapped: false, lastRun: null });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });
  it("POST with the token runs the deletion once and answers its result", async () => {
    const res = await POST(req("POST", `Bearer ${TOKEN}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "off", result: { ok: true, deleted: 0, done: true } });
    const status = await (await GET(req("GET", `Bearer ${TOKEN}`))).json();
    expect(status.lastRun).toMatchObject({ ok: true });
  });
  it("limits attempts per address, valid or not: a guesser is slowed to a crawl and then told to stop", async () => {
    const ip = "203.0.113.200";
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await GET(req("GET", `Bearer guess-${i}`, ip))).status);
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(30).every((s) => s === 429)).toBe(true);
    expect((await GET(req("GET", `Bearer ${TOKEN}`, ip))).status).toBe(429); // even the right token waits: the window is per address
    expect((await GET(req("GET", `Bearer ${TOKEN}`, "203.0.113.201"))).status).toBe(200); // another address is unaffected
  });
});
