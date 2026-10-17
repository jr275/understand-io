/* Does the saved theme land before first paint? Run: pnpm exec tsx scripts/theme-paint-check.mts [baseUrl] */
import { chromium } from "@playwright/test";

interface Entry {
  t: number;
  theme?: string;
  ev: string;
}
declare global {
  interface Window {
    __themeLog: Entry[];
  }
}

const base = process.argv[2] ?? "http://localhost:3100";
const browser = await chromium.launch();
for (const throttle of [false, true]) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  await ctx.addInitScript(() => {
    window.__themeLog = [];
    const log = window.__themeLog;
    const obs = new MutationObserver((ms) => {
      for (const m of ms) if (m.type === "attributes" && m.target === document.documentElement) log.push({ t: performance.now(), theme: document.documentElement.dataset.theme, ev: "attr" });
    });
    obs.observe(document, { attributes: true, subtree: true, attributeFilter: ["data-theme"] });
    document.addEventListener("DOMContentLoaded", () => log.push({ t: performance.now(), theme: document.documentElement.dataset.theme, ev: "DOMContentLoaded" }));
  });
  const page = await ctx.newPage();
  if (throttle) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: 400 * 1024, uploadThroughput: 200 * 1024 });
  }
  await page.goto(base + "/");
  await page.evaluate(() => localStorage.setItem("gloss:settings", JSON.stringify({ theme: "night" })));
  await page.goto(base + "/library", { waitUntil: "load" });
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    paints: performance.getEntriesByType("paint").map((p) => ({ name: p.name, t: Math.round(p.startTime) })),
    log: window.__themeLog.map((x) => ({ ...x, t: Math.round(x.t) })),
    final: document.documentElement.dataset.theme,
  }));
  const firstPaint = r.paints.find((p) => p.name === "first-paint")?.t ?? Infinity;
  const themeAt = r.log.find((e) => e.ev === "attr" && e.theme === "night")?.t ?? Infinity;
  console.log(`${throttle ? "SLOW" : "FAST"} network: theme at ${themeAt} ms, first paint at ${firstPaint} ms → ${themeAt < firstPaint ? "OK (before paint)" : "FLASH"}`, JSON.stringify(r));
  await ctx.close();
}
await browser.close();
