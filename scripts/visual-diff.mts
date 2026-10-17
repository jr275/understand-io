/*
 * Pixel diff of this build against the saved reference captures (docs/qa/ref-*.png, same viewports, dark, signed out).
 * Run against a dev server:  pnpm exec tsx scripts/visual-diff.mts [baseUrl]
 * Each screen is compared twice: with the current colour tokens, and with the original reference values of the tokens
 * that were adjusted for WCAG AA contrast, so the fidelity cost of the accessibility fix is measured, not assumed.
 * Differences are expected anyway: painted imagery, the partner logo, fonts that render slightly differently, and
 * dynamic content. Treat the numbers as a comparison between the two runs, not as a pass mark.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pixelmatch from "pixelmatch";
import pngjs from "pngjs";

const { PNG } = pngjs;
const base = process.argv[2] ?? "http://localhost:3100";
const outDir = "docs/audit/visual";
mkdirSync(outDir, { recursive: true });

// Original reference values of the tokens changed for contrast (night theme is the dark capture).
const ORIGINAL_NIGHT = `[data-theme="night"]{--ink-3:#878073;--ink-4:#5b564d;--lens-mute:#7d766a}`;
const screens = [
  { slug: "landing", path: "/" },
  { slug: "library", path: "/library" },
  { slug: "reader", path: "/read/on-a-piece-of-chalk" },
];
const sizes = { desktop: { width: 1440, height: 900 }, mobile: { width: 375, height: 812 } };

async function shot(path: string, viewport: { width: number; height: number }, original: boolean) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "dark", reducedMotion: "reduce" });
  await ctx.addInitScript(
    ({ css, original }) => {
      localStorage.setItem("gloss:settings", JSON.stringify({ theme: "night" }));
      if (original) document.addEventListener("DOMContentLoaded", () => document.head.appendChild(Object.assign(document.createElement("style"), { textContent: css })));
    },
    { css: ORIGINAL_NIGHT, original },
  );
  const page = await ctx.newPage();
  await page.goto(base + path);
  await page.waitForTimeout(1800);
  const buf = await page.screenshot();
  await browser.close();
  return PNG.sync.read(buf);
}

function diff(a: InstanceType<typeof PNG>, b: InstanceType<typeof PNG>) {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const crop = (p: InstanceType<typeof PNG>) => {
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(p, out, 0, 0, w, h, 0, 0);
    return out;
  };
  const [ca, cb] = [crop(a), crop(b)];
  const out = new PNG({ width: w, height: h });
  const n = pixelmatch(ca.data, cb.data, out.data, w, h, { threshold: 0.1 });
  return { pct: (n / (w * h)) * 100, png: out };
}

const rows: string[] = [];
for (const [sizeName, vp] of Object.entries(sizes)) {
  for (const s of screens) {
    const refPath = `docs/qa/ref-${s.slug}-${sizeName}.png`;
    if (!existsSync(refPath)) continue;
    const ref = PNG.sync.read(readFileSync(refPath));
    const cur = diff(ref, await shot(s.path, vp, false));
    const old = diff(ref, await shot(s.path, vp, true));
    writeFileSync(`${outDir}/diff-${s.slug}-${sizeName}.png`, PNG.sync.write(cur.png));
    rows.push(`${s.slug.padEnd(8)} ${sizeName.padEnd(8)} current ${cur.pct.toFixed(2)}%   original tokens ${old.pct.toFixed(2)}%   cost ${(cur.pct - old.pct).toFixed(2)} pt`);
  }
}
console.log(rows.join("\n"));
