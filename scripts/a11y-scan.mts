/*
 * Automated accessibility scan (axe-core, WCAG 2.0/2.1 A + AA + best practices) across the real UI states.
 * Run against a dev server:  pnpm exec tsx scripts/a11y-scan.mts [baseUrl] [outFile.json]
 * Automated scans catch roughly a third of WCAG issues; keyboard, focus order and screen-reader behaviour
 * still need the manual checks recorded in docs/audit/visual-accessibility-review.md.
 */
import AxeBuilder from "@axe-core/playwright";
import { chromium, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3100";
const outFile = process.argv[3];

interface State {
  name: string;
  path: string;
  viewport?: { width: number; height: number };
  setup?: (page: Page) => Promise<void>;
}

async function selectText(page: Page) {
  await page.evaluate(() => {
    const blk = document.querySelector('.blk[data-block="p2"]')!;
    blk.scrollIntoView({ block: "center" });
    const text = blk.querySelector(".blk-text")!;
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode()!;
    const r = document.createRange();
    r.setStart(first, 0);
    r.setEnd(first, Math.min(40, first.textContent!.length));
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  });
  await page.getByRole("toolbar", { name: "Actions for the selection" }).waitFor();
}

const READER = "/read/on-a-piece-of-chalk";
const states: State[] = [
  { name: "landing", path: "/" },
  { name: "landing + paste dialog", path: "/", setup: async (p) => void (await p.getByRole("button", { name: "Paste text" }).click()) },
  { name: "library", path: "/library" },
  { name: "library + add panel", path: "/library", setup: async (p) => void (await p.getByRole("button", { name: /Add articles/ }).click()) },
  { name: "library + open book", path: "/library", setup: async (p) => void (await p.locator("button.bk").first().click()) },
  { name: "reader", path: READER },
  { name: "reader + appearance", path: READER, setup: async (p) => void (await p.getByRole("button", { name: "Appearance and answers" }).click()) },
  { name: "reader + key panel", path: READER, setup: async (p) => void (await p.getByRole("button", { name: "Together API key" }).click()) },
  { name: "reader + keys dialog", path: READER, setup: async (p) => void (await p.keyboard.press("?")) },
  { name: "reader + selection toolbar", path: READER, setup: selectText },
  { name: "reader + notebook", path: READER, setup: async (p) => void (await p.keyboard.press("n")) },
  { name: "reader + listen bar", path: READER, setup: async (p) => void (await p.keyboard.press("l")) },
  { name: "reader + voice search", path: READER, setup: async (p) => void (await p.keyboard.press("v")) },
  { name: "reader (phone 375x812)", path: READER, viewport: { width: 375, height: 812 } },
  { name: "landing (phone 375x812)", path: "/", viewport: { width: 375, height: 812 } },
];

interface Row {
  theme: string;
  state: string;
  violations: { id: string; impact: string | null | undefined; help: string; nodes: number; sample: string[] }[];
}

const browser = await chromium.launch();
const rows: Row[] = [];
for (const theme of ["paper", "night"]) {
  for (const s of states) {
    const ctx = await browser.newContext({ viewport: s.viewport ?? { width: 1440, height: 900 }, reducedMotion: "reduce" });
    await ctx.addInitScript((t) => localStorage.setItem("gloss:settings", JSON.stringify({ theme: t })), theme);
    const page = await ctx.newPage();
    await page.goto(base + s.path);
    await page.waitForTimeout(900);
    if (s.path.startsWith("/read/")) await page.locator("[data-reader-ready]").waitFor({ state: "attached" });
    try {
      await s.setup?.(page);
      await page.waitForTimeout(500);
    } catch (e) {
      rows.push({ theme, state: s.name, violations: [{ id: "scan-setup-failed", impact: "n/a", help: String(e).slice(0, 160), nodes: 0, sample: [] }] });
      await ctx.close();
      continue;
    }
    const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
    rows.push({
      theme,
      state: s.name,
      violations: res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes.slice(0, 3).map((n) => n.target.join(" ").slice(0, 110)) })),
    });
    await ctx.close();
  }
}
await browser.close();

for (const r of rows) {
  const line = r.violations.length ? r.violations.map((v) => `${v.id}(${v.impact},${v.nodes})`).join(", ") : "none";
  console.log(`[${r.theme.padEnd(5)}] ${r.state.padEnd(30)} ${line}`);
}
const byRule = new Map<string, { impact: string; help: string; states: Set<string>; nodes: number; sample: string }>();
for (const r of rows)
  for (const v of r.violations) {
    const e = byRule.get(v.id) ?? { impact: String(v.impact), help: v.help, states: new Set<string>(), nodes: 0, sample: v.sample[0] ?? "" };
    e.states.add(`${r.theme}:${r.state}`);
    e.nodes += v.nodes;
    byRule.set(v.id, e);
  }
console.log("\nDISTINCT RULES");
for (const [id, e] of byRule) console.log(`- ${id} [${e.impact}] ${e.help} — ${e.states.size} state(s), ${e.nodes} node(s); e.g. ${e.sample}`);
if (outFile) writeFileSync(outFile, JSON.stringify(rows, null, 1));
