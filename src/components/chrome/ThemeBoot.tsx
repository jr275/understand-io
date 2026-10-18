"use client";

import { useSyncExternalStore } from "react";
import { THEME_BOOT_SCRIPT } from "@/lib/store/settings";

const noop = () => () => {};

/**
 * Inline script that applies the saved theme before first paint.
 *
 * It must be a raw <script> in <head> so it runs synchronously while the HTML is parsed
 * (next/script's beforeInteractive runs after the runtime chunk loads, which is after first paint
 * on slow networks). React 19 warns whenever it *creates* a <script> during a client render, so the
 * element is rendered only for the server snapshot and the hydration pass; once mounted it renders
 * nothing (the script has already run), and client re-renders (Fast Refresh, navigations) never
 * create a script element.
 */
export function ThemeBoot() {
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  if (hydrated) return null;
  // Hosts (e.g. the v0 preview) may inject their own inline <script> at the top of <head>, which
  // hydration then pairs with this element; the content differing is expected and harmless.
  return <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />;
}
