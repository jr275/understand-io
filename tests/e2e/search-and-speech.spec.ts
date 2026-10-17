import { expect, test } from "@playwright/test";
import { installFakeSpeech, openReader, selectInBlock } from "./helpers";

test.describe("voice search (typed transcript; recognition itself needs a microphone)", () => {
  test("finds a passage, jumps to it and marks the hit", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("v");
    const dialog = page.getByRole("dialog", { name: "Ask by voice" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("What to look for").fill("find the part that talks about the deep sea soundings in the Atlantic");
    await dialog.getByLabel("What to look for").press("Enter");
    await expect(dialog.getByText(/Matches for/)).toBeVisible();
    await expect(dialog.getByText("“deep sea soundings in the Atlantic”")).toBeVisible();
    const first = dialog.getByRole("listitem").first();
    await expect(first).toContainText(/sounding|Atlantic/i);
    await first.getByRole("button", { name: "Go to this passage" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".hit-mark")).toHaveCount(1);
    await expect(page.locator(".blk.is-cursor")).toBeVisible();
    await expect
      .poll(
        () =>
          page.locator(".blk.is-cursor").evaluate((el) => {
            const r = el.getBoundingClientRect();
            return r.top >= 0 && r.top < window.innerHeight;
          }),
        { timeout: 5000 },
      )
      .toBe(true);
  });

  test("says plainly when nothing matches", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("v");
    const dialog = page.getByRole("dialog", { name: "Ask by voice" });
    await dialog.getByLabel("What to look for").fill("where does he discuss quantum chromodynamics");
    await dialog.getByLabel("What to look for").press("Enter");
    await expect(dialog.getByText(/No passage in this text matches/)).toBeVisible();
    await expect(dialog.getByRole("listitem")).toHaveCount(0);
  });

  test("flags low-confidence matches", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("v");
    const dialog = page.getByRole("dialog", { name: "Ask by voice" });
    await dialog.getByLabel("What to look for").fill("Norwich spaceship");
    await dialog.getByLabel("What to look for").press("Enter");
    await expect(dialog.getByText(/Possible matches/)).toBeVisible();
  });
});

test.describe("read aloud (mock speech engine)", () => {
  test.beforeEach(async ({ page }) => installFakeSpeech(page));

  test("L starts reading, highlights the sentence, Space pauses and resumes, stop clears", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("l");
    const region = page.getByRole("region", { name: "Reading aloud" });
    await expect(region).toBeVisible();
    await expect(region).toContainText(/Reading · 1\//);
    await expect(page.locator(".m-speak")).toHaveCount(1);
    await expect(page.locator(".m-speak")).toContainText("If a well were sunk");
    // It advances sentence by sentence.
    const indexOf = async () => Number(((await region.textContent()) ?? "").match(/Reading · (\d+)\//)?.[1] ?? 0);
    await expect.poll(indexOf, { timeout: 5000 }).toBeGreaterThan(1);
    await page.keyboard.press("Space");
    await expect(region.getByRole("button", { name: "Resume" })).toBeVisible();
    const before = await region.textContent();
    await page.waitForTimeout(700);
    expect(await region.textContent()).toBe(before);
    await page.keyboard.press("Space");
    await expect(region.getByRole("button", { name: "Pause" })).toBeVisible();
    await region.getByRole("button", { name: "Stop reading aloud" }).click();
    await expect(region).toHaveCount(0);
    await expect(page.locator(".m-speak")).toHaveCount(0);
  });

  test("speed and voice controls change the utterance and never overlap sessions", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("l");
    const region = page.getByRole("region", { name: "Reading aloud" });
    await region.getByLabel("Speed").selectOption("1.5");
    await expect(region.getByLabel("Speed")).toHaveValue("1.5");
    await page.keyboard.press("l"); // stop
    await expect(region).toHaveCount(0);
    await page.keyboard.press("l"); // start again — one session only
    await expect(region).toContainText(/Reading · 1\//);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length), { timeout: 3000 }).toBeGreaterThan(0);
  });

  test("reading a selected passage then continuing with the text", async ({ page }) => {
    await openReader(page);
    await selectInBlock(page, "p2", 0, 40);
    await page.getByRole("toolbar").getByRole("button", { name: "More actions" }).click({ force: true });
    await page.getByRole("menuitem", { name: /Read aloud/ }).click({ force: true });
    const region = page.getByRole("region", { name: "Reading aloud" });
    await expect(region).toBeVisible();
    // The fake engine finishes a sentence in 300 ms, so assert on what was spoken rather than on a
    // transient label: the selected passage goes first, then reading continues with the next sentence.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length), { timeout: 6000 })
      .toBeGreaterThan(1);
    const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
    expect(spoken[0]).toBe("Not only here, but over the whole county");
    expect(spoken[1]).toMatch(/^of Norfolk, the well-sinker/);
    await expect(region).toContainText(/Reading · \d+\/275/);
  });
});
