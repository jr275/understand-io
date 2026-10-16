/* Capture comparison screenshots of the implementation at the reference viewports. */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.env.BASE_URL ?? "http://localhost:3100";
const out = "docs/qa";
mkdirSync(out, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  for (const [name, viewport] of Object.entries({ desktop: { width: 1440, height: 900 }, mobile: { width: 375, height: 812 } })) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "dark" });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem("gloss:settings", JSON.stringify({ theme: "night" })));
    for (const [slug, path] of Object.entries({ landing: "/", library: "/library", reader: "/read/on-a-piece-of-chalk" })) {
      await page.goto(base + path);
      await page.waitForTimeout(1600);
      await page.screenshot({ path: `${out}/${slug}-${name}.png` });
      if (slug === "reader" && name === "desktop") {
        await page.evaluate(() => {
          const t = document.querySelector('.blk[data-block="p1"] .blk-text span')!;
          const n = (t.firstChild!.nodeType === 3 ? t.firstChild : t.firstChild!.firstChild) as Node;
          const r = document.createRange();
          r.setStart(n, 0);
          r.setEnd(n, 60);
          const s = getSelection()!;
          s.removeAllRanges();
          s.addRange(r);
        });
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${out}/reader-lens-${name}.png` });
        await page.getByRole("button", { name: "Appearance and answers" }).click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${out}/reader-appearance-${name}.png` });
        await page.keyboard.press("Escape");
        await page.keyboard.press("n");
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${out}/reader-notebook-${name}.png` });
        await page.keyboard.press("Escape");
      }
      if (slug === "library" && name === "desktop") {
        await page.locator("button.bk").first().click();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${out}/library-openbook-${name}.png` });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(600);
        await page.getByRole("radio", { name: "Topics" }).click();
        await page.waitForTimeout(800);
        await page.screenshot({ path: `${out}/library-topics-${name}.png` });
      }
    }
    await ctx.close();
  }
  await browser.close();
}
main();
