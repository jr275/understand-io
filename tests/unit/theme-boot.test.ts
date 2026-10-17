// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { ThemeBoot } from "@/components/chrome/ThemeBoot";
import { THEME_BOOT_SCRIPT } from "@/lib/store/settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scriptWarning = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.some((c: unknown[]) => String(c[0]).includes("Encountered a script tag"));

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("ThemeBoot", () => {
  it("control: a raw <script> created during a client render makes React warn (the original console error)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = document.body.appendChild(document.createElement("div"));
    await act(async () => createRoot(el).render(createElement("script", { dangerouslySetInnerHTML: { __html: "void 0" } })));
    expect(scriptWarning(err)).toBe(true);
  });

  it("server render emits the inline script so the theme is set while the HTML is parsed", () => {
    const html = renderToString(createElement(ThemeBoot));
    expect(html).toContain("<script>");
    expect(html).toContain(THEME_BOOT_SCRIPT);
  });

  it("a client render (Fast Refresh, error-boundary reset, remount) creates no script element and no warning", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = document.body.appendChild(document.createElement("div"));
    await act(async () => createRoot(el).render(createElement(ThemeBoot)));
    expect(el.querySelector("script")).toBeNull();
    expect(scriptWarning(err)).toBe(false);
  });

  it("hydrates the server markup without a mismatch warning", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const el = document.body.appendChild(document.createElement("div"));
    el.innerHTML = renderToString(createElement(ThemeBoot));
    expect(el.querySelector("script")).not.toBeNull();
    await act(async () => {
      hydrateRoot(el, createElement(ThemeBoot));
    });
    expect(err).not.toHaveBeenCalled();
  });
});
