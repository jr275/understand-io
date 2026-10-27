import { expect, test, type Page, type Route } from "@playwright/test";
import { installFakeSpeech, openReader } from "./helpers";

/**
 * What a reader sees when the shared AI says no: the daily allowance is used, a generation is already running, or the beta's budget is spent.
 * The server's answers are stand-ins with the shape and wording the real routes send (they are proven against real servers in
 * tests/integration/allowances.test.ts); what is checked here is the screen: the message is shown in plain words, with the way forward,
 * the app does not retry on its own, and nothing is spoken or lost.
 */
const QUOTA = { status: 429, json: { error: "quota", message: "You have used today's 3 free AI questions. Sign in with Google for 20 a day, add your own Together key with the key button in the top bar, or come back tomorrow." } };
const BUSY = { status: 429, json: { error: "busy-user", message: "You already have an AI answer being written. Wait for it to finish, then ask again." } };
const BUDGET = { status: 503, json: { error: "budget", message: "The beta's AI budget for today is used up, so the shared AI is paused until it renews (UTC). You can keep going with your own Together key (the key button in the top bar)." } };
const UNAVAILABLE = { status: 503, json: { error: "unavailable", message: "The AI is temporarily unavailable. Try again in a minute." } };

async function refuseAi(page: Page, answer: { status: number; json: object }) {
  const seen: string[] = [];
  await page.route("**/api/ai", async (route: Route) => {
    seen.push(route.request().method());
    await route.fulfill(answer);
  });
  return seen;
}

test.describe("when the shared AI says no", () => {
  for (const [name, answer, shows] of [
    ["the daily allowance is used up", QUOTA, /3 free AI questions.*Sign in with Google for 20 a day.*your own Together key/],
    ["a generation is already running", BUSY, /already have an AI answer being written/],
    ["the beta's budget is spent", BUDGET, /budget for today is used up.*your own Together key/],
    ["the allowances cannot be read", UNAVAILABLE, /temporarily unavailable/],
  ] as const) {
    test(`a summary: ${name}`, async ({ page }) => {
      const seen = await refuseAi(page, answer);
      await openReader(page);
      await page.keyboard.press("i");
      const panel = page.getByRole("complementary", { name: "Understand" });
      await panel.getByRole("region", { name: "Make something" }).getByRole("button", { name: /^Quick summary/ }).click();
      const card = panel.locator("[data-insight]").first();
      await expect(card).toContainText(shows);
      expect(seen).toEqual(["POST"]); // one request: the app did not retry by itself
      await page.waitForTimeout(1200);
      expect(seen).toHaveLength(1);
      // The panel is still usable: the reader can try again, or delete the card.
      await expect(card.getByRole("button", { name: /Try again|Delete this result/ }).first()).toBeVisible();
    });
  }

  test("a question asked by voice or typing: the margin answer is refused with the same words, and nothing is read aloud", async ({ page }) => {
    await installFakeSpeech(page);
    await page.route("**/api/gloss", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      await route.fulfill(QUOTA);
    });
    await openReader(page);
    await page.keyboard.press("v");
    const p = page.getByRole("dialog", { name: "Ask by voice" });
    await p.getByRole("button", { name: "Ask a question" }).click();
    await p.getByLabel("Your question about the text").fill("Will I be told why?");
    await p.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(p.getByRole("alert")).toContainText(/3 free AI questions/);
    await expect(p.getByRole("alert")).toContainText(/Sign in with Google/);
    const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.slice());
    expect(spoken).toEqual([]);
  });

  test("the reader keeps reading: highlights and notes need no AI and are not affected", async ({ page }) => {
    await refuseAi(page, BUDGET);
    await openReader(page);
    await expect(page.locator(".blk").first()).toBeVisible();
    await page.keyboard.press("i");
    await expect(page.getByRole("complementary", { name: "Understand" })).toBeVisible();
  });
});
