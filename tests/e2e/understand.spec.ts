import { expect, test, type Page, type Route } from "@playwright/test";
import { openReader, selectInBlock } from "./helpers";

/**
 * The Understand panel, the lens buttons and the result cards, with /api/ai answered by a stand-in for the model (no provider key exists
 * in this environment). What is real here: the UI, the request the app builds, how a result is stored, shown, reloaded and deleted, and
 * how evidence chips navigate. What is NOT proven here: that a live model returns good JSON; that is covered by unit tests with a fake model
 * and stays unverified against Together AI until a key is available.
 */
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
    await panel.getByRole("button", { name: "Quick summary" }).click();
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
      await panel.getByRole("button", { name: name, exact: true }).click();
      await expect(panel.locator("[data-insight]").first().getByRole("heading", { name })).toBeVisible();
    }
    await panel.getByRole("button", { name: "Test me" }).click();
    await expect(panel.locator("[data-insight]").first().getByRole("heading", { name: "Questions to check your understanding" })).toBeVisible();
    await panel.getByRole("button", { name: "Key concepts" }).click();
    await expect.poll(() => requests.map((r) => `${r.op}:${r.variant ?? ""}`)).toEqual(["summarize:executive", "summarize:detailed", "summarize:ideas", "questions:", "concepts:"]);
    // Answers to comprehension questions stay hidden until asked for.
    const q = panel.locator("[data-insight]").nth(1);
    await expect(q).not.toContainText("Its own subject.");
    await q.getByRole("button", { name: "Show the answer" }).click();
    await expect(q).toContainText("Its own subject.");
  });

  test("the answer language is sent when chosen", async ({ page }) => {
    const requests = await mockAi(page);
    await openReader(page);
    await page.keyboard.press("i");
    const panel = page.getByRole("complementary", { name: "Understand" });
    await panel.getByLabel("Answer in").selectOption("pt");
    await panel.getByRole("button", { name: "Key ideas" }).click();
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
    await panel.getByRole("button", { name: "Quick summary" }).click();
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
    await panel.getByRole("button", { name: "Quick summary" }).click();
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
    await panel.getByRole("button", { name: "Quick summary" }).click();
    const card = panel.locator("[data-insight]").first();
    await expect(card.getByRole("alert")).toContainText(/key/i);
    await expect(page.locator(".prose-read .blk").first()).toBeVisible();
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
