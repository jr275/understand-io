import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "@/lib/server/reader";
import { codeChallenge, newOAuthState } from "@/lib/server/auth";

describe("signed tokens", () => {
  it("round-trips and keeps kinds apart", () => {
    const t = signToken("session", "a_123");
    expect(verifyToken("session", t)).toBe("a_123");
    expect(verifyToken("oauth", t)).toBeNull(); // a session token is not an oauth token
    expect(verifyToken("session", t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(verifyToken("session", "a_123")).toBeNull();
    expect(verifyToken("session", undefined)).toBeNull();
  });
  it("tolerates dots inside the value (base64url JSON state)", () => {
    const value = Buffer.from(JSON.stringify({ a: 1 })).toString("base64url") + ".x";
    expect(verifyToken("oauth", signToken("oauth", value))).toBe(value);
  });
});

describe("oauth state", () => {
  it("generates unpredictable state and a PKCE S256 challenge, and only allows local next paths", () => {
    const a = newOAuthState("/library");
    const b = newOAuthState("https://evil.example/");
    expect(a.state).not.toBe(b.state);
    expect(a.verifier.length).toBeGreaterThanOrEqual(43);
    expect(b.next).toBe("/library");
    // RFC 7636 test vector.
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
});
