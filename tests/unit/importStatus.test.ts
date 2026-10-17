import { describe, expect, it } from "vitest";
import { describeFetchStatus } from "@/lib/server/importStatus";
import { bookmarklet } from "@/lib/client/bookmarklet";

describe("describeFetchStatus", () => {
  it("explains bot-blocked publishers and points at the bookmarklet instead of echoing '403'", () => {
    for (const code of [401, 403, 429, 451]) {
      const d = describeFetchStatus(code);
      expect(d.blocked, String(code)).toBe(true);
      expect(d.status).toBe(422);
      expect(d.error).toMatch(/bookmarklet/);
      expect(d.error).not.toMatch(/403/);
    }
  });
  it("keeps other statuses honest", () => {
    expect(describeFetchStatus(404)).toMatchObject({ status: 404, blocked: false });
    expect(describeFetchStatus(503)).toMatchObject({ status: 502, blocked: false });
    expect(describeFetchStatus(418).error).toContain("418");
  });
});

describe("bookmarklet", () => {
  it("opens the capture page with the article URL and only answers the ready handshake from that window and origin", () => {
    const src = bookmarklet("https://understand.example", "save");
    expect(src.startsWith("javascript:")).toBe(true);
    expect(src).toContain("/?capture=save&url='+encodeURIComponent(location.href)");
    expect(src).toContain("e.source!==w");
    expect(src).toContain("e.origin!==o");
    expect(src).toContain("documentElement.outerHTML");
    // Valid JavaScript: it must parse.
    expect(() => new Function(src.slice("javascript:".length))).not.toThrow();
  });
});
