import { expect, test, type Page } from "@playwright/test";
import { installFakeSpeech, openReader, speakCalls, spokenText } from "./helpers";

/**
 * Questions asked in the voice panel, in the real reader. The model is a stand-in for /api/gloss and the speech engine is a fake
 * (no microphone, no audio, no provider key here): what is checked is the flow, the checked citations, when the voice may speak, and that
 * the microphone is never started by asking. Real recognition, real audio and a live model remain unverified.
 */
const SENTINEL = "\u001e";
async function mockGloss(page: Page, text: string, status = 200) {
  const bodies: { question?: string; action: string; context: { id: string }[]; history?: unknown[] }[] = [];
  await page.route("**/api/gloss", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postDataJSON());
    if (status !== 200) return route.fulfill({ status, json: { error: "provider", message: "The shared AI service could not answer right now." } });
    await route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: `${text}${SENTINEL}${JSON.stringify({ model: "test/model", usage: { input: 10, output: 5, cost: 0 } })}` });
  });
  return bodies;
}
const panel = (page: Page) => page.getByRole("dialog", { name: "Ask by voice" });

test.describe("ask by voice (stand-ins for the model and the speech engine)", () => {
  test.beforeEach(async ({ page }) => installFakeSpeech(page));

  test("a question is answered in the panel and in the margin, read aloud once, with checked citations", async ({ page }) => {
    const bodies = await mockGloss(page, "==Chalk is made of tiny shells.== The text says so early on ¶2. It also claims a thing far away ¶999. My reading: this is a long record.");
    await openReader(page);
    await page.keyboard.press("v");
    const p = panel(page);
    await p.getByRole("button", { name: "Ask a question" }).click();
    await p.getByLabel("Your question about the text").fill("What is chalk made of?");
    await p.getByRole("button", { name: "Ask", exact: true }).click();
    const conv = p.locator("[data-conversation]");
    await expect(conv).toContainText("What is chalk made of?");
    await expect(conv).toContainText("Chalk is made of tiny shells.");
    await expect(conv.getByRole("button", { name: "Jump to paragraph 2" })).toBeVisible();
    await expect(conv.locator("[data-unverified='999']")).toBeVisible();
    await expect(conv.locator("[data-basis='My reading']")).toBeVisible();
    // The question went to the model as a whole-text question, with the paragraphs chosen for it.
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ action: "whole", question: "What is chalk made of?" });
    expect(bodies[0].context.length).toBeGreaterThan(3);
    // It was read aloud, without citations or markdown marks, and only once.
    await expect.poll(async () => (await spokenText(page)).join(" ")).toContain("Chalk is made of tiny shells.");
    const said = (await spokenText(page)).join(" ");
    expect(said).not.toContain("¶");
    expect(said).not.toContain("==");
    await page.waitForTimeout(1500);
    expect((await spokenText(page)).filter((t) => t.startsWith("Chalk is made")).length).toBe(1);
    // The same answer sits in the margin.
    await conv.getByRole("button", { name: "Show in the margin" }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator("article.gloss.is-active")).toContainText("Chalk is made of tiny shells.");
  });

  test("a follow-up continues the conversation (the earlier turns are sent), and New question starts a fresh one", async ({ page }) => {
    const bodies = await mockGloss(page, "==Because of the sea.== See ¶2.");
    await openReader(page);
    await page.keyboard.press("v");
    const p = panel(page);
    await p.getByRole("button", { name: "Ask a question" }).click();
    await p.getByLabel("Your question about the text").fill("Why is chalk white?");
    await p.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(p.locator("[data-conversation]")).toContainText("Because of the sea.");
    await p.getByLabel("Your question about the text").fill("And flint?");
    await p.getByRole("button", { name: "Ask", exact: true }).click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1].question).toBe("And flint?");
    expect(bodies[1].history?.length).toBeGreaterThanOrEqual(2);
    await p.getByRole("button", { name: "New question" }).click();
    await expect(p.locator("[data-conversation]")).not.toContainText("Because of the sea.");
    await p.getByLabel("Your question about the text").fill("A new topic");
    await p.getByRole("button", { name: "Ask", exact: true }).click();
    await expect.poll(() => bodies.length).toBe(3);
    expect(bodies[2].history ?? []).toEqual([]);
  });

  test("the composer's microphone opens the panel ready for a question; Read answers aloud can be switched off", async ({ page }) => {
    await mockGloss(page, "==A short answer.==");
    await openReader(page);
    await page.getByRole("button", { name: /voice|microphone|Ask by voice/i }).first().click();
    const p = panel(page);
    await expect(p.getByLabel("Your question about the text")).toBeVisible();
    await p.getByLabel("Read answers aloud when they are ready").uncheck();
    await p.getByLabel("Your question about the text").fill("Anything?");
    await p.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(p.locator("[data-conversation]")).toContainText("A short answer.");
    await page.waitForTimeout(800);
    expect(await spokenText(page)).toEqual([]);
    await p.getByRole("button", { name: "Read this answer aloud" }).click();
    await expect.poll(async () => (await spokenText(page)).join(" ")).toContain("A short answer.");
  });

  test("asking never starts the microphone; the voice speaks at the reader's chosen rate; reading the text aloud gives way to the answer", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __mic: number }).__mic = 0;
      const md = { getUserMedia: async () => { (window as unknown as { __mic: number }).__mic++; throw new DOMException("denied", "NotAllowedError"); } };
      Object.defineProperty(navigator, "mediaDevices", { value: md, configurable: true });
      class Rec { start() { (window as unknown as { __mic: number }).__mic++; } stop() {} abort() {} }
      (window as unknown as Record<string, unknown>).SpeechRecognition = Rec;
    });
    await page.addInitScript(() => localStorage.setItem("gloss:settings", JSON.stringify({ rate: 1.5 })));
    await mockGloss(page, "==Answer.== Details follow.");
    await openReader(page);
    await page.keyboard.press("l");
    await expect(page.getByRole("region", { name: "Reading aloud" })).toBeVisible();
    await page.keyboard.press("v");
    const p = panel(page);
    await p.getByRole("button", { name: "Ask a question" }).click();
    await p.getByLabel("Your question about the text").fill("Anything?");
    await p.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(p.locator("[data-conversation]")).toContainText("Answer.");
    await expect(page.getByRole("region", { name: "Reading aloud" })).toHaveCount(0); // the reading stopped before the answer was spoken
    await expect.poll(async () => (await speakCalls(page)).some((c) => c.text === "Answer.")).toBe(true);
    const call = (await speakCalls(page)).find((c) => c.text === "Answer.")!;
    expect(call.rate).toBe(1.5);
    expect(call.pausedAtSpeak).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { __mic: number }).__mic)).toBe(0);
  });

  test("a failed answer is shown as an error and nothing is spoken", async ({ page }) => {
    await mockGloss(page, "", 502);
    await openReader(page);
    await page.keyboard.press("v");
    const p = panel(page);
    await p.getByRole("button", { name: "Ask a question" }).click();
    await p.getByLabel("Your question about the text").fill("Will this work?");
    await p.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(p.getByRole("alert")).toContainText("could not answer");
    expect(await spokenText(page)).toEqual([]);
  });

  test("without any key the real server says what is needed", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("v");
    const p = panel(page);
    await p.getByRole("button", { name: "Ask a question" }).click();
    await p.getByLabel("Your question about the text").fill("Is anyone there?");
    await p.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(p.getByRole("alert")).toContainText(/key/i);
    expect(await spokenText(page)).toEqual([]);
  });

  test("the panel with an answer on screen has no accessibility violations", async ({ page }) => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    await mockGloss(page, "==Chalk is soft.== See ¶2 and ¶999. My reading: more.");
    await openReader(page);
    await page.keyboard.press("v");
    const p = panel(page);
    await p.getByRole("button", { name: "Ask a question" }).click();
    await p.getByLabel("Your question about the text").fill("What is chalk?");
    await p.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(p.locator("[data-conversation]")).toContainText("Chalk is soft.");
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
    expect(r.violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
  });
});
