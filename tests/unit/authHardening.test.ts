// SEC-12 / SEC-13: cookie secret policy, `next` validation, and where the OAuth origin comes from.
import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appOrigin, newOAuthState, safeNext } from "@/lib/server/auth";
import { readerCookieValue, signToken, verifyReaderCookie } from "@/lib/server/reader";

afterEach(() => vi.unstubAllEnvs());

describe("safeNext", () => {
  it("keeps ordinary same-site paths", () => {
    for (const p of ["/library", "/read/on-a-piece-of-chalk", "/read/x?hl=chalk&n=2#p3", "/", "/a/b.c-d_e%20f"]) expect(safeNext(p), p).toBe(p);
  });
  it("turns anything that could leave the site, or is not a plain path, into the library", () => {
    for (const p of ["//evil.example", "//evil.example/x", "/\\evil.example", "/\\\\evil.example", "\\\\evil.example", "https://evil.example/", "javascript:alert(1)", "evil", "", "/a\nb", "/a b", "/\u0000", "/" + "a".repeat(600), "/%0d%0aSet-Cookie:x=y".replace("%0d%0a", "\r\n")]) expect(safeNext(p), JSON.stringify(p)).toBe("/library");
  });
  it("is what newOAuthState stores", () => {
    expect(newOAuthState("//evil.example").next).toBe("/library");
    expect(newOAuthState("/read/x").next).toBe("/read/x");
  });
});

describe("appOrigin", () => {
  const req = new Request("http://internal:3000/api/auth/google", { headers: { host: "attacker.example", "x-forwarded-host": "attacker.example", "x-forwarded-proto": "https" } });
  it("in production refuses to guess from forwarded headers: APP_URL is required", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "");
    expect(() => appOrigin(req)).toThrow(/APP_URL must be set in production/);
    vi.stubEnv("APP_URL", "https://understand.example/");
    expect(appOrigin(req)).toBe("https://understand.example");
  });
  it("outside production it still follows the request, so local development needs no configuration", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("APP_URL", "");
    expect(appOrigin(new Request("http://localhost:3201/api/auth/google"))).toBe("http://localhost:3201");
  });
});

describe("cookie secret", () => {
  it("in production must be at least 32 characters and not the example value", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const bad of ["", "change-me", "short-secret", "x".repeat(31)]) {
      vi.stubEnv("GLOSS_COOKIE_SECRET", bad);
      expect(() => signToken("session", "a_1"), JSON.stringify(bad)).toThrow(/GLOSS_COOKIE_SECRET must be set to at least 32 characters/);
    }
    vi.stubEnv("GLOSS_COOKIE_SECRET", "x".repeat(32));
    expect(signToken("session", "a_1")).toMatch(/^a_1\./);
  });
  it("outside production keeps working with the development fallback", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("GLOSS_COOKIE_SECRET", "");
    expect(signToken("session", "a_1")).toMatch(/^a_1\./);
  });
  it("leaves the reader cookie format alone: `id.signature`, verifying with the same secret (existing readers stay signed in)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("GLOSS_COOKIE_SECRET", "0123456789abcdef0123456789abcdef0123456789abcdef");
    const v = readerCookieValue("r_abcdefghijkl");
    expect(v).toMatch(/^r_abcdefghijkl\.[A-Za-z0-9_-]{22}$/);
    expect(verifyReaderCookie(v)).toBe("r_abcdefghijkl");
    // Independent computation of what the previous version issued (HMAC-SHA256 of the bare id, base64url, 22 characters).
    const issuedBefore = `r_abcdefghijkl.${createHmac("sha256", "0123456789abcdef0123456789abcdef0123456789abcdef").update("r_abcdefghijkl").digest("base64url").slice(0, 22)}`;
    expect(v).toBe(issuedBefore);
    expect(verifyReaderCookie(issuedBefore)).toBe("r_abcdefghijkl");
  });
});
