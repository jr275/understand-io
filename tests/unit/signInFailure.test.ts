import { afterEach, describe, expect, it, vi } from "vitest";
import { SignInError, signInFailure } from "@/lib/server/auth";

afterEach(() => vi.restoreAllMocks());

describe("what the reader sees when sign-in fails", () => {
  it("passes on the messages the app wrote for the reader", () => {
    expect(signInFailure(new SignInError("Google did not accept the sign-in (400)."))).toBe("Google did not accept the sign-in (400).");
    expect(signInFailure(new SignInError("Sign-in needs a database."))).toBe("Sign-in needs a database.");
  });

  it("never shows a database error: its message carries the SQL of the failed query", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const dbError = Object.assign(new Error('Failed query: select "id", "email" from "accounts" where ("accounts"."provider" = $1 and "accounts"."subject" = $2)'), {
      cause: { code: "28P01" },
    });
    const shown = signInFailure(dbError);
    expect(shown).not.toMatch(/select|accounts|Failed query|\$1/i);
    expect(shown).toMatch(/could not be completed on the server/i);
    // the operator still learns what happened, by code only
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("28P01");
    expect(String(log.mock.calls[0][0])).not.toMatch(/select|accounts/i);
  });

  it("treats any other failure the same way", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(signInFailure(new TypeError("fetch failed"))).toMatch(/could not be completed on the server/i);
    expect(signInFailure("a string")).toMatch(/could not be completed on the server/i);
  });
});
