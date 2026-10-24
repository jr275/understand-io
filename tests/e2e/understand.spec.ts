import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { openReader, selectInBlock } from "./helpers";

/**
 * The Understand panel, the lens buttons and the result cards, with /api/ai answered by a stand-in for the model (no provider key exists
 * in this environment). What is real here: the UI, the request the app builds, how a result is stored, shown, reloaded and deleted, and
 * how evidence chips navigate. What is NOT proven here: that a live model returns good JSON; that is covered by unit tests with a fake model
 * and stays unverified against Together AI until a key is available.
 */

/** Press one of the "make something" buttons. Once a result exists they tuck away behind "Make something new", so open that first when needed. */
async function press(panel: ReturnType<Page["getByRole"]>, name: string) {
  // Scoped to the region that holds what can be made (in both its open and tucked-away states): a result card's own header
  // ("Quick summary just now…") has a name that starts the same way and sits outside it.
  const region = panel.getByRole("region", { name: "Make something" });
  const b = region.getByRole("button", { name: new RegExp(`^${name}`) });
  if (!(await b.isVisible())) await region.getByRole("button", { name: "Make something new" }).click();
  await b.click();
}

interface Sent {
  op: string;
  variant?: string;
  selection?: string;
  targetLang?: string;
  outputLang?: string;
  totalParagraphs: number;
  blocks: { id: string; n?: number; type?: string; text: string }[];
}

function summaryFor(sent: Sent) {
  const real = sent.blocks.find((b) => b.n && b.text.length > 60)!;
  const quote = real.text.slice(0, 48);
  return {
    kind: "summary",
    variant: sent.variant ?? "quick",
    items: [
      { text: "The first real paragraph says something specific.", basis: "text", evidence: [{ blockId: real.id, n: real.n, quote, start: 0, end: 48 }] },
      { text: "A broader reading the model offers.", basis: "interpretation", unverified: true, evidence: [] },
    ],
    caveats: ["Test caveat."],
    coverage: { used: sent.blocks.filter((b) => b.n).length, total: sent.totalParagraphs, from: 1, to: sent.blocks.filter((b) => b.n).length, complete: true },
  };
}

async function mockAi(page: Page, handler?: (sent: Sent, route: Route) => Promise<boolean | void>) {
  const requests: Sent[] = [];
  await page.route("**/api/ai", async (route) => {
    const sent = route.request().postDataJSON() as Sent;
    requests.push(sent);
    if (handler && (await handler(sent, route))) return;
    const result =
      sent.op === "translate"
        ? { kind: "translation", sourceLang: "en", targetLang: sent.targetLang, original: sent.selection, natural: "Tradução de teste.", literal: "Literal de teste.", notes: ["Nota de teste."], contextUsed: sent.blocks.length > 0 }
        : sent.op === "questions"
          ? { ...summaryFor(sent), kind: "questions", items: [{ text: "What is the first paragraph about?", answer: "Its own subject.", basis: "text", evidence: [] }] }
          : summaryFor(sent);
    await route.fulfill({ json: { result, model: "test/model", usage: { input: 10, output: 5, cost: 0 } } });
  });
  return requests;
}

test.describe("Understand panel (model answered by a stand-in)", () => {
  test("a summary is requested for the document, shown with coverage, quotes and honest labels, and kept after reload", async ({ page }) => {
    const requests = await mockAi(page);
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    await expect(panel).toBeVisible();
    await press(panel, "Quick summary");
    const card = panel.locator("[data-insight]").first();
    await expect(card.getByRole("heading", { name: "Quick summary" })).toBeVisible();
    await expect(card).toContainText("Based on the whole text");
    await expect(card).toContainText("The first real paragraph says something specific.");
    await expect(card.getByText("Interpretation · no quote found")).toBeVisible();
    await expect(card).toContainText("Test caveat.");
    await expect(card).toContainText("Quotes were checked against the text");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ op: "summarize", variant: "quick" });
    expect(requests[0].blocks.length).toBeGreaterThan(30); // the whole sample, not a fragment
    expect(requests[0].totalParagraphs).toBe(63);
    // Evidence chips lead to the paragraph that holds the quote.
    await card.getByRole("button", { name: /Go to paragraph/ }).first().click();
    await expect(page.locator(".blk.is-cursor")).toBeVisible();
    // Kept with the document: still there after a reload.
    await page.reload();
    await page.locator("[data-reader-ready]").waitFor({ state: "attached" });
    await page.keyboard.press("i");
    await expect(page.getByRole("complementary", { name: "Understand" }).locator("[data-insight]")).toHaveCount(1);
    // Delete.
    await page.getByRole("complementary", { name: "Understand" }).getByRole("button", { name: "Delete this result" }).click();
    await expect(page.getByRole("complementary", { name: "Understand" }).locator("[data-insight]")).toHaveCount(0);
  });

  test("the four summary kinds, concepts and questions each send their own operation", async ({ page }) => {
    const requests = await mockAi(page);
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    for (const name of ["Executive summary", "Detailed summary", "Key ideas"]) {
      await press(panel, name);
      await expect(panel.locator("[data-insight]").first().getByRole("heading", { name })).toBeVisible();
    }
    await press(panel, "Test me");
    await expect(panel.locator("[data-insight]").first().getByRole("heading", { name: "Questions to check your understanding" })).toBeVisible();
    await press(panel, "Key concepts");
    await expect.poll(() => requests.map((r) => `${r.op}:${r.variant ?? ""}`)).toEqual(["summarize:executive", "summarize:detailed", "summarize:ideas", "questions:", "concepts:"]);
    // Answers to comprehension questions stay hidden until asked for.
    const q = panel.locator("[data-insight]").nth(1);
    await q.locator("button[aria-expanded]").first().click(); // older results start collapsed
    await expect(q).not.toContainText("Its own subject.");
    await q.getByRole("button", { name: "Show the answer" }).click();
    await expect(q).toContainText("Its own subject.");
  });

  test("before anything is made, each button says what it will produce; afterwards they tuck away", async ({ page }) => {
    await mockAi(page);
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    const list = panel.getByRole("list", { name: "What you can make" });
    await expect(list.getByRole("listitem")).toHaveCount(8); // quick, executive, detailed, key ideas, study notes, concepts, test me, translate
    await expect(list).toContainText("A few paragraphs: is this worth reading?");
    await expect(list).toContainText("Outline, definitions, claims, takeaways and questions to recall");
    await expect(list).toContainText("Questions that check your understanding; answers stay hidden");
    await expect(list).toContainText("A page at a time, with the original beside it");
    await expect(panel.getByRole("button", { name: "Make something new" })).toHaveCount(0);
    await press(panel, "Quick summary");
    await expect(panel.locator("[data-insight]")).toHaveCount(1);
    await expect(list).toHaveCount(0);
    const more = panel.getByRole("button", { name: "Make something new" });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByRole("button", { name: "Executive summary" })).toBeVisible();
    await more.click();
    await expect(panel.getByRole("button", { name: "Executive summary" })).toHaveCount(0);
  });

  test("the newest result is open, older ones are collapsed with a preview and open on demand (mouse or keyboard); tabs filter by kind", async ({ page }) => {
    await mockAi(page);
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    await press(panel, "Quick summary");
    await expect(panel.locator("[data-insight]")).toHaveCount(1);
    await press(panel, "Executive summary");
    await expect(panel.locator("[data-insight]")).toHaveCount(2);
    const [newest, older] = [panel.locator("[data-insight]").nth(0), panel.locator("[data-insight]").nth(1)];
    await expect(newest.locator("button[aria-expanded]").first()).toHaveAttribute("aria-expanded", "true");
    await expect(newest).toContainText("Based on the whole text");
    await expect(older.locator("button[aria-expanded]").first()).toHaveAttribute("aria-expanded", "false");
    await expect(older).not.toContainText("Based on the whole text");
    await expect(older).toContainText("The first real paragraph says something specific."); // the preview
    // Keyboard: the header is a button.
    await older.locator("button[aria-expanded]").first().focus();
    await page.keyboard.press("Enter");
    await expect(older).toContainText("Based on the whole text");
    await page.keyboard.press("Space");
    await expect(older).not.toContainText("Based on the whole text");
    // Tabs appear once there are more than two results.
    await expect(panel.getByRole("tablist", { name: "Show" })).toHaveCount(0);
    await press(panel, "Test me");
    await expect(panel.locator("[data-insight]")).toHaveCount(3);
    const tabs = panel.getByRole("tablist", { name: "Show" });
    await expect(tabs.getByRole("tab", { name: /^Summaries/ })).toContainText("2");
    await expect(tabs.getByRole("tab", { name: /^Learn/ })).toContainText("1");
    await expect(tabs.getByRole("tab", { name: /^Translations/ })).toBeDisabled();
    await tabs.getByRole("tab", { name: /^Learn/ }).click();
    await expect(panel.locator("[data-insight]")).toHaveCount(1);
    await tabs.getByRole("tab", { name: /^All/ }).click();
    await expect(panel.locator("[data-insight]")).toHaveCount(3);
  });

  test("the answer language is sent when chosen", async ({ page }) => {
    const requests = await mockAi(page);
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    await panel.getByLabel("Answer in").selectOption("pt");
    await press(panel, "Key ideas");
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].outputLang).toBe("pt");
  });

  test("Translate in the selection toolbar shows original and translation side by side and leaves the text alone", async ({ page }) => {
    const requests = await mockAi(page);
    await openReader(page);
    const before = await page.locator('.blk[data-block="p2"]').innerText();
    await selectInBlock(page, "p2", 0, 40);
    await page.getByRole("toolbar", { name: "Actions for the selection" }).getByRole("button", { name: "Translate" }).click();
    const panel = page.getByRole("complementary", { name: "Understand" });
    await expect(panel).toBeVisible();
    const card = panel.locator("[data-insight]").first();
    await expect(card.getByRole("heading", { name: "Translation to Portuguese" })).toBeVisible();
    await expect(card.getByText("Original (English)")).toBeVisible();
    await expect(card.getByText("Tradução de teste.")).toBeVisible();
    await expect(card.getByText("Literal de teste.")).toBeVisible();
    await expect(card.getByText("Nota de teste.")).toBeVisible();
    expect(requests[0]).toMatchObject({ op: "translate", targetLang: "pt" });
    expect(requests[0].selection).toBe(before.slice(0, 40));
    expect(await page.locator('.blk[data-block="p2"]').innerText()).toBe(before); // the document is never replaced by the translation
  });

  test("whole-text translation goes part by part: from the paragraph on screen, then the next part, never past what was translated", async ({ page }) => {
    const requests = await mockAi(page);
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    await press(panel, "Translate from the paragraph on screen");
    const first = panel.locator("[data-insight]").first();
    await expect(first.getByRole("heading", { name: "Translation to Portuguese" })).toBeVisible();
    expect(requests[0].op).toBe("translate");
    expect(requests[0].blocks).toEqual([]);
    expect(requests[0].selection!.length).toBeLessThanOrEqual(6000);
    expect(requests[0].selection).toContain("\n\n"); // paragraph breaks are kept in what is sent
    const m = /Paragraphs (\d+) to (\d+)/.exec((await first.innerText()) ?? "")!;
    expect(m).not.toBeNull();
    const to = Number(m[2]);
    expect(to).toBeGreaterThan(1);
    // The next part starts right after the one before.
    const nextText = await page.locator(`.blk[data-n="${to + 1}"] .blk-text`).innerText();
    await first.getByRole("button", { name: "Translate the next part" }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].selection!.startsWith(nextText.slice(0, 40))).toBe(true);
    await expect(panel.locator("[data-insight]")).toHaveCount(2);
  });

  test("Summarize in the selection toolbar summarizes only the passage and says so", async ({ page }) => {
    const requests = await mockAi(page, async (sent, route) => {
      const real = sent.blocks[0];
      await route.fulfill({
        json: {
          result: { kind: "summary", variant: "passage", items: [{ text: "About the passage.", basis: "text", evidence: [{ blockId: real.id, n: real.n, quote: real.text.slice(0, 30), start: 0, end: 30 }] }], caveats: [], coverage: { used: 1, total: 63, from: real.n ?? 0, to: real.n ?? 0, complete: false, note: "Summary of the selected passage only." } },
          model: "test/model",
        },
      });
      return true;
    });
    await openReader(page);
    await selectInBlock(page, "p2", 0, 60);
    await page.getByRole("toolbar", { name: "Actions for the selection" }).getByRole("button", { name: "Summarize" }).click();
    const card = page.getByRole("complementary", { name: "Understand" }).locator("[data-insight]").first();
    await expect(card.getByRole("heading", { name: "Summary of a passage" })).toBeVisible();
    await expect(card).toContainText("Summary of the selected passage only.");
    expect(requests[0]).toMatchObject({ op: "summarize", variant: "passage" });
    expect(requests[0].blocks.length).toBeLessThanOrEqual(2);
    await expect(card.getByRole("button", { name: /Summarize the rest/ })).toHaveCount(0); // a passage summary never offers to continue
  });

  test("a failure shows the reason with Try again, and trying again works; nothing is stored for the failure", async ({ page }) => {
    let calls = 0;
    await mockAi(page, async (_sent, route) => {
      calls++;
      if (calls > 1) return false;
      await route.fulfill({ status: 502, json: { error: "provider", message: "The AI service could not answer right now. Try again." } });
      return true;
    });
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    await press(panel, "Quick summary");
    const card = panel.locator("[data-insight]").first();
    await expect(card.getByRole("alert")).toContainText("could not answer right now");
    await card.getByRole("button", { name: "Try again" }).click();
    await expect(card).toContainText("Based on the whole text");
    expect(calls).toBe(2);
  });

  test("Cancel stops a request that is still running", async ({ page }) => {
    await mockAi(page, async (_s, route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.abort().catch(() => {});
      return true;
    });
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    await press(panel, "Quick summary");
    await expect(panel.getByRole("status")).toContainText("Reading the text");
    await panel.getByRole("button", { name: "Cancel" }).click();
    await expect(panel.locator("[data-insight]")).toHaveCount(0);
  });
});

test.describe("Understand panel without a key (the real server)", () => {
  test("says what is needed and keeps the reading intact", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    await expect(panel.getByRole("note")).toContainText("Together AI key");
    await press(panel, "Quick summary");
    const card = panel.locator("[data-insight]").first();
    await expect(card.getByRole("alert")).toContainText(/key/i);
    await expect(page.locator(".prose-read .blk").first()).toBeVisible();
  });
});

test.describe("Understand panel accessibility", () => {
  for (const theme of ["paper", "night"] as const) {
    test(`no axe violations with results, a translation and an error on screen (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("gloss:settings", JSON.stringify({ theme: t })), theme);
      let calls = 0;
      await mockAi(page, async (_s, route) => {
        calls++;
        if (calls === 3) {
          await route.fulfill({ status: 502, json: { error: "provider", message: "The AI service could not answer right now. Try again." } });
          return true;
        }
        return false;
      });
      await openReader(page);
      await selectInBlock(page, "p2", 0, 40);
      await page.getByRole("toolbar", { name: "Actions for the selection" }).getByRole("button", { name: "Translate" }).click();
      const panel = page.getByRole("complementary", { name: "Understand" });
      await expect(panel.locator("[data-insight]")).toHaveCount(1);
      await press(panel, "Executive summary");
      await expect(panel.locator("[data-insight]")).toHaveCount(2);
      await press(panel, "Test me");
      await expect(panel.locator("[data-insight]").first().getByRole("alert")).toBeVisible();
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
      expect(r.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
    });
  }
  for (const theme of ["paper", "night"] as const) {
    test(`no axe violations in the empty state, where every button carries its description (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("gloss:settings", JSON.stringify({ theme: t })), theme);
      await openReader(page);
      await page.keyboard.press("i");
      await expect(page.getByRole("list", { name: "What you can make" })).toBeVisible();
      await page.waitForTimeout(500);
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
      expect(r.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
    });
  }
  test("on a phone the panel fits the screen without horizontal scrolling", async ({ page }) => {
    await mockAi(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await openReader(page);
    await page.getByRole("button", { name: "Understand" }).click();
    const panel = page.getByRole("complementary", { name: "Understand" });
    await press(panel, "Quick summary");
    await expect(panel.locator("[data-insight]")).toHaveCount(1);
    const overflow = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth - window.innerWidth, panel: (() => { const p = document.querySelector('aside[aria-label="Understand"]') as HTMLElement; return p.scrollWidth - p.clientWidth; })() }));
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.panel).toBeLessThanOrEqual(0);
  });
});

test.describe("margin answers: citations and coverage (the model answered by a stand-in)", () => {
  const SENTINEL = "\u001e";
  async function mockGloss(page: Page, text: string) {
    await page.route("**/api/gloss", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: `${text}${SENTINEL}${JSON.stringify({ model: "test/model", usage: { input: 10, output: 5, cost: 0 } })}` });
    });
  }

  test("a citation to a paragraph the model was never given is shown as unverified; a real one still jumps; labels become badges", async ({ page }) => {
    await mockGloss(page, "==It says something.== The text puts it first ¶2. It also claims a thing far away ¶60. My reading: this means more than it says.");
    await openReader(page);
    await selectInBlock(page, "p2", 0, 40);
    await page.getByRole("toolbar", { name: "Actions for the selection" }).getByRole("button", { name: "Explain" }).click();
    const card = page.locator("article.gloss.is-active");
    await expect(card).toContainText("It says something.");
    await expect(card.getByRole("button", { name: "Jump to paragraph 2" })).toBeVisible();
    await expect(card.locator("[data-unverified='60']")).toBeVisible();
    await expect(card.getByRole("button", { name: "Jump to paragraph 60" })).toHaveCount(0);
    await expect(card.locator("[data-basis='My reading']")).toBeVisible();
  });

  test("a whole-text overview says how many paragraphs the model actually read", async ({ page }) => {
    await mockGloss(page, "==The gist.== See ¶1.");
    await openReader(page);
    await page.getByRole("button", { name: /Gloss this text/ }).click();
    const card = page.locator("article.gloss.is-active");
    await expect(card).toContainText("The gist.");
    const note = card.locator("[data-coverage]");
    await expect(note).toBeVisible();
    await expect(note).toContainText(/Based on \d+ of 63 paragraphs/);
    await expect(note).toContainText("The rest was not read");
  });
});

test.describe("Study notes, versions of the text, reuse and regenerate (model answered by a stand-in)", () => {
  const DOC_ID = "sample:on-a-piece-of-chalk";
  const FAKE_HASH = "f".repeat(64);

  /** Make the browser's own copy of the results the only one, so a change made to it in a test is not replaced by the server's copy on reload. */
  async function localOnly(page: Page) {
    await page.route("**/api/documents/*/data", (route) => route.fulfill({ json: { persisted: false } }));
  }
  /**
   * Reload with the stored results rewritten to say they were written for another text (a hash) or for none recorded (null). The rewrite runs
   * before the page's own scripts start: a live page writes its in-memory state back to storage as it unloads, which would undo a change made to
   * the storage of the page being left.
   */
  async function reloadWithHash(page: Page, hash: string | null) {
    await page.addInitScript(
      ({ id, hash }) => {
        try {
          const raw = localStorage.getItem("gloss:v1");
          if (!raw) return;
          const s = JSON.parse(raw);
          for (const g of s.glosses?.[id] ?? []) {
            if (!g.result || g.result.kind === "stream") continue;
            if (hash === null) delete g.result.docHash;
            else g.result.docHash = hash;
          }
          localStorage.setItem("gloss:v1", JSON.stringify(s));
        } catch {
          /* storage unavailable: the test then fails visibly on its own assertion */
        }
      },
      { id: DOC_ID, hash },
    );
    await page.reload();
  }

  test("Study notes is asked for as its own kind of summary and kept with a record of the text it was written for", async ({ page }) => {
    const requests = await mockAi(page);
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    await press(panel, "Study notes");
    const card = panel.locator("[data-insight]").first();
    await expect(card.getByRole("heading", { name: "Study notes" })).toBeVisible();
    expect(requests.map((r) => [r.op, r.variant])).toEqual([["summarize", "study"]]);
    await expect.poll(() => page.evaluate((id) => (JSON.parse(localStorage.getItem("gloss:v1")!).glosses[id] ?? []).map((g: { result?: { docHash?: string; outLang?: string } }) => g.result?.docHash), DOC_ID)).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)]);
  });

  test("asking again for what already exists for this text shows it, and does not ask the model again; Regenerate does", async ({ page }) => {
    const requests = await mockAi(page);
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    await press(panel, "Quick summary");
    await expect(panel.locator("[data-insight]")).toHaveCount(1);
    await expect(panel.getByText("Reading the text…")).toHaveCount(0);

    await press(panel, "Quick summary");
    await expect(page.getByText("You already have this for this version of the text")).toBeVisible();
    await expect(panel.locator("[data-insight]")).toHaveCount(1);
    expect(requests).toHaveLength(1); // no second request

    await panel.getByRole("button", { name: "Regenerate" }).click();
    await expect(panel.locator("[data-insight]")).toHaveCount(2);
    expect(requests).toHaveLength(2);
  });

  test("a result written for another version of the text says so and offers to be made again; one with no record says that instead, never 'earlier'", async ({ page }) => {
    await localOnly(page);
    await mockAi(page);
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    await press(panel, "Quick summary");
    await expect(panel.locator("[data-insight]")).toHaveCount(1);
    await expect(panel.locator("[data-version]")).toHaveCount(0); // written for exactly this text: nothing to warn about

    await reloadWithHash(page, FAKE_HASH);
    await page.keyboard.press("i");
    await expect(panel.locator("[data-version='earlier']")).toContainText("Written for an earlier version of this text");
    await expect(panel.locator("[data-version='earlier']").getByRole("button", { name: "Regenerate" })).toBeVisible();

    await reloadWithHash(page, null); // as results made before versions were recorded
    await page.keyboard.press("i");
    await expect(panel.locator("[data-version='earlier']")).toHaveCount(0);
    await expect(panel.locator("[data-version='unknown']")).toContainText("was not recorded");
  });

  test("an old result is not reused for a request: the model is asked again", async ({ page }) => {
    await localOnly(page);
    const requests = await mockAi(page);
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    await press(panel, "Quick summary");
    await expect(panel.locator("[data-insight]")).toHaveCount(1);
    await reloadWithHash(page, FAKE_HASH);
    await page.keyboard.press("i");
    await press(panel, "Quick summary");
    await expect(panel.locator("[data-insight]")).toHaveCount(2);
    expect(requests).toHaveLength(2);
  });
});
