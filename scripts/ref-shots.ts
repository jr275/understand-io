/* Capture the public reference (signed out) at the same viewports as qa-shots.ts, for side-by-side comparison. */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = "docs/qa";
mkdirSync(out, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 375, height: 812 } })) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "dark" });
    const page = await ctx.newPage();
    for (const [slug, path] of Object.entries({ landing: "/", library: "/library", reader: "/read/on-a-piece-of-chalk" })) {
      await page.goto("https://www.usegloss.io" + path, { waitUntil: "networkidle" });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${out}/ref-${slug}-${name}.png` });
      if (slug === "library" && name === "desktop") {
        await page.getByRole("radio", { name: "Topics" }).click();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${out}/ref-library-topics-${name}.png` });
      }
    }
    await ctx.close();
  }
  await browser.close();
}
main();
