import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bookmarklet } from "@/lib/client/bookmarklet";

const read = (p: string) => readFileSync(new URL(`../../extension/${p}`, import.meta.url), "utf8");
const manifest = JSON.parse(read("manifest.json")) as Record<string, unknown>;

describe("Chrome extension (milestone 1)", () => {
  it("is a Manifest V3 extension called Keeple with the smallest set of permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe("Keeple");
    expect([...(manifest.permissions as string[])].sort()).toEqual(["activeTab", "contextMenus", "scripting"]);
    expect(manifest.host_permissions).toBeUndefined(); // activeTab is enough: nothing is read before a click
    expect(JSON.stringify(manifest)).not.toMatch(/<all_urls>|\*:\/\/\*|http:\/\//);
    expect(manifest.content_scripts).toBeUndefined();
  });

  it("points at files that exist and at the production address only", () => {
    const m = manifest as { background: { service_worker: string }; action: { default_popup: string } };
    expect(read(m.background.service_worker).length).toBeGreaterThan(100);
    expect(read(m.action.default_popup)).toContain("popup.js");
    expect(read("background.js")).toContain('const ORIGIN = "https://www.keeple.me";');
    expect(read("background.js")).not.toMatch(/understand-io\.vercel\.app/);
  });

  it("speaks the bookmarklet's protocol: same capture address, same ready and page messages", () => {
    const code = bookmarklet("https://www.keeple.me", "read");
    const bg = read("background.js");
    for (const token of ["understand:ready", "understand:page", "/?capture=", "&url=", "encodeURIComponent(location.href)", "documentElement.outerHTML"]) {
      expect(code, `bookmarklet: ${token}`).toContain(token);
      expect(bg, `extension: ${token}`).toContain(token);
    }
    expect(bg).toContain("e.origin !== origin"); // only Keeple's own tab may receive the page
  });

  it("falls back to opening Keeple with the address filled in when the page's window is refused or the page cannot be scripted", () => {
    const bg = read("background.js");
    expect(bg).toMatch(/return false;/); // capture reports a refused window
    expect(bg).toContain("r?.result === true");
    expect(bg).toContain('chrome.tabs.create({ url: ORIGIN + "/?url=" + encodeURIComponent(tab.url) })');
  });

  it("sends a page only after a click: no automatic listeners on page loads or navigation", () => {
    const bg = read("background.js");
    expect(bg).not.toMatch(/tabs\.onUpdated|webNavigation|onCommitted|onCompleted/);
    expect(bg).toMatch(/contextMenus\.onClicked/);
  });
});
