import { expect, test } from "@playwright/test";
import { openReader, selectInBlock } from "./helpers";

test.describe("annotations in the reader", () => {
  test("ANNOT-10: a note is capped at 5000 characters in the lens and in the margin editor, with a counter", async ({ page }) => {
    await openReader(page);
    await selectInBlock(page, "p4", 0, 30);
    await page.getByRole("toolbar").getByRole("button", { name: "Add a note" }).click({ force: true });
    const box = page.getByLabel("Your note on the selected passage");
    await box.fill("a".repeat(5001));
    await expect(box).toHaveValue("a".repeat(5000));
    await expect(page.getByTestId("note-counter")).toHaveText("5000/5000");
    await page.keyboard.press("Enter");
    await expect(page.locator(".m-note")).toHaveCount(1);
    // The stored note is the capped one, and the margin editor enforces the same limit.
    const stored = await page.evaluate(() => (JSON.parse(localStorage.getItem("gloss:v1")!).annotations["sample:on-a-piece-of-chalk"] as { note: string }[])[0].note.length);
    expect(stored).toBe(5000);
    await page.getByRole("button", { name: /Note on paragraph 4/ }).click(); // a new note is already active: one click opens the editor
    const edit = page.getByLabel("Edit note");
    await edit.fill("é".repeat(5003));
    await expect(edit).toHaveValue("é".repeat(5000));
    await expect(page.getByTestId("note-counter")).toHaveText("5000/5000");
  });
});
