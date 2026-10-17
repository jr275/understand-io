import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { openReader, selectInBlock } from "./helpers";

const DOC = "sample:on-a-piece-of-chalk";
const sample = JSON.parse(readFileSync(join(process.cwd(), "src/content/samples/on-a-piece-of-chalk.json"), "utf8")) as { blocks: { id: string; text: string; n?: number }[] };
const textOf = (id: string) => sample.blocks.find((b) => b.id === id)!.text;

/** Store annotations in localStorage before the app starts (as if saved by an earlier visit). Seeds are plain anchors as older versions stored them. */
async function seed(page: Page, annotations: object[]) {
  const state = { docs: {}, progress: {}, annotations: { [DOC]: annotations }, glosses: {}, hidden: [], deleted: [] };
  await page.addInitScript(
    ({ key, value }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, value);
    },
    { key: "gloss:v1", value: JSON.stringify(state) },
  );
}
const now = Date.now();
/** An annotation on `quote` in block `b`, stored `shift` characters away from where the text really is. */
function onQuote(id: string, b: string, quote: string, shift: number, over: object = {}) {
  const t = textOf(b);
  const o = t.indexOf(quote);
  expect(o, `quote must exist in ${b}`).toBeGreaterThanOrEqual(0);
  return { id, documentId: DOC, kind: "highlight", color: "yellow", createdAt: now - 5000, updatedAt: now - 5000, ...over, anchor: { start: { b, o: o + shift }, end: { b, o: o + shift + quote.length }, quote, prefix: t.slice(Math.max(0, o - 32), o), suffix: t.slice(o + quote.length, o + quote.length + 32) } };
}
/** An annotation whose passage is not in the document at all. */
const missing = (id: string, b: string, quote: string, over: object = {}) => ({ id, documentId: DOC, kind: "highlight", color: "pink", createdAt: now - 4000, updatedAt: now - 4000, ...over, anchor: { start: { b, o: 0 }, end: { b, o: quote.length }, quote } });

/** Remove every notebook item (one at a time, waiting for the list to settle) so tests leave the shared database as they found it. */
async function removeAll(nb: Locator) {
  const buttons = nb.getByRole("button", { name: "Remove" });
  for (let i = 0; i < 10 && (await buttons.count()) > 0; i++) {
    const before = await buttons.count();
    await buttons.first().click({ force: true });
    await expect(buttons).toHaveCount(before - 1);
  }
}

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

  test("ANNOT-4: an annotation whose passage is gone gets no mark, and is listed as 'couldn't find this passage' with Delete", async ({ page }) => {
    await seed(page, [
      onQuote("seedkeep0001", "p2", "over the whole county of Norfolk", 0),
      missing("seedgone0001", "p3", "a sentence that is not anywhere in this text"),
      missing("seedgone0002", "p4", "another vanished passage, with a note", { kind: "note", note: "my note on the vanished passage", color: "blue" }),
    ]);
    await openReader(page);
    // Only the findable highlight is painted; no stale mark, note mark or note dot for the orphans.
    await expect(page.locator(".m-hl")).toHaveCount(1);
    await expect(page.locator(".m-hl")).toHaveText("over the whole county of Norfolk");
    await expect(page.locator(".m-note")).toHaveCount(0);
    await expect(page.locator(".note-dot")).toHaveCount(0);
    // The margin lists both orphans under a clear heading, each with Delete.
    const margin = page.locator(".rg-margin");
    await expect(margin.getByTestId("orphan-heading")).toHaveText("Couldn’t find this passage");
    await expect(margin.locator("[data-orphan]")).toHaveCount(2);
    await expect(margin.locator('[data-orphan="seedgone0002"]')).toContainText("my note on the vanished passage");
    // Delete one from the margin card.
    await margin.locator('[data-orphan="seedgone0001"]').getByRole("button", { name: "Delete" }).click();
    await expect(margin.locator("[data-orphan]")).toHaveCount(1);
    // The notebook labels the other one too, does not offer to jump to it, and can remove it.
    await page.keyboard.press("n");
    const nb = page.getByRole("complementary", { name: "Notebook" });
    await expect(nb.locator("[data-orphan]")).toHaveCount(1);
    await expect(nb.locator('[data-orphan="seedgone0002"]')).toContainText("Couldn’t find this passage");
    await expect(nb.locator('[data-orphan="seedgone0002"] button').first()).toBeDisabled();
    await nb.locator('[data-orphan="seedgone0002"]').getByRole("button", { name: "Remove" }).click({ force: true });
    await expect(margin.locator("[data-orphan]")).toHaveCount(0);
    await expect(margin.getByTestId("orphan-heading")).toHaveCount(0);
    // The findable one survives a reload; remove it so the shared database is left as it was found.
    await page.reload();
    await expect(page.locator(".m-hl")).toHaveCount(1);
    await page.keyboard.press("n");
    await nb.getByRole("button", { name: "Remove" }).click({ force: true });
    await expect(page.locator(".m-hl")).toHaveCount(0);
  });

  test("ANNOT-5: a mark whose stored offsets are stale is painted, clicked and listed at the text's current position", async ({ page }) => {
    const quote = "over the whole county of Norfolk";
    await seed(page, [onQuote("seedshift001", "p2", quote, 10), onQuote("seedshift002", "p4", "a thickness of more than a thousand feet", 7, { kind: "note", note: "shifted note", color: "green" })]);
    await openReader(page);
    await expect(page.locator(".m-hl")).toHaveText(quote);
    // Clicking the mark selects the passage it paints (not whatever sits at the old offsets).
    await page.locator(".m-hl").click();
    // (the lens paints the pending selection as .m-pending; the native selection is replaced by that paint)
    await expect(page.locator(".m-pending")).toHaveText(quote);
    await page.keyboard.press("Escape");
    // The note's mark, card and dot follow the resolved position.
    await expect(page.locator(".m-note")).toHaveText("a thickness of more than a thousand feet");
    await expect(page.getByRole("button", { name: /Note on paragraph 4/ })).toContainText("shifted note");
    await expect(page.locator('.blk[data-block="p4"] .note-dot')).toHaveCount(1);
    // Clean up through the UI (this also exercises the server DELETE for a seeded, then uploaded, item).
    await page.keyboard.press("n");
    const nb = page.getByRole("complementary", { name: "Notebook" });
    await removeAll(nb);
    await expect(page.locator(".m-hl, .m-note")).toHaveCount(0);
  });

  test("ANNOT-7: a triple-click selects exactly one paragraph, also the last one, and highlights it", async ({ page }) => {
    const last = [...sample.blocks].reverse().find((b) => b.n)!;
    await openReader(page);
    for (const id of ["p4", last.id]) {
      const para = page.locator(`.blk[data-block="${id}"] .blk-text`);
      await para.scrollIntoViewIfNeeded();
      await para.click({ clickCount: 3 });
      const lens = page.getByRole("toolbar", { name: "Actions for the selection" });
      await expect(lens, `lens after triple-click on ${id}`).toBeVisible();
      await lens.getByRole("button", { name: "Highlight", exact: true }).click();
      await expect(page.locator(`.blk[data-block="${id}"] .m-hl`)).toHaveText(textOf(id));
    }
    // Both annotations are stored as exactly their paragraph: one block, no trailing newline, nothing spilling into the next block.
    const stored = await page.evaluate(() => (JSON.parse(localStorage.getItem("gloss:v1")!).annotations["sample:on-a-piece-of-chalk"] as { anchor: { start: { b: string }; end: { b: string }; quote: string } }[]).map((a) => a.anchor));
    expect(stored.map((a) => [a.start.b, a.end.b, a.quote])).toEqual([
      ["p4", "p4", textOf("p4")],
      [last.id, last.id, last.text],
    ]);
    // Clean up through the notebook.
    await page.keyboard.press("n");
    const nb = page.getByRole("complementary", { name: "Notebook" });
    await removeAll(nb);
    await expect(page.locator(".m-hl")).toHaveCount(0);
  });

  test("ANNOT-14: the same highlight on the same range toggles off, another colour recolours it, and the lens offers Remove", async ({ page }) => {
    await openReader(page);
    const lens = page.getByRole("toolbar", { name: "Actions for the selection" });
    const stored = () => page.evaluate(() => (JSON.parse(localStorage.getItem("gloss:v1")!).annotations["sample:on-a-piece-of-chalk"] as unknown[]).length);
    await selectInBlock(page, "p2", 0, 40);
    await page.keyboard.press("Shift+H");
    await expect(page.locator(".m-hl")).toHaveCount(1);
    // Pressing Shift+H again on the same range (selected again) takes the highlight off instead of stacking a second one.
    await selectInBlock(page, "p2", 0, 40);
    await expect(lens.getByRole("button", { name: "Remove highlight" })).toBeVisible();
    await page.keyboard.press("Shift+H");
    await expect(page.locator(".m-hl")).toHaveCount(0);
    expect(await stored()).toBe(0);
    // Highlight again, then pick another colour for the same range: one mark, new colour.
    await selectInBlock(page, "p2", 0, 40);
    await page.keyboard.press("Shift+H");
    await expect(page.locator(".m-hl")).toHaveCount(1);
    await selectInBlock(page, "p2", 0, 40);
    await lens.getByRole("button", { name: "Highlight", exact: true }).hover();
    await lens.getByRole("button", { name: "Highlight in green" }).click();
    await expect(page.locator(".m-hl")).toHaveCount(1);
    await expect(page.locator(".m-hl").first()).toHaveAttribute("data-c", "green");
    expect(await stored()).toBe(1);
    // The Remove button takes it off too; a different range is not affected.
    await selectInBlock(page, "p2", 0, 20);
    await expect(lens.getByRole("button", { name: "Remove highlight" })).toHaveCount(0);
    await selectInBlock(page, "p2", 0, 40);
    await lens.getByRole("button", { name: "Remove highlight" }).click();
    await expect(page.locator(".m-hl")).toHaveCount(0);
    expect(await stored()).toBe(0);
  });

  test("ANNOT-13: dragging a selection inside an existing highlight keeps that selection (the click does not replace it)", async ({ page }) => {
    await openReader(page);
    await selectInBlock(page, "p2", 0, 60);
    await page.keyboard.press("Shift+H");
    await expect(page.locator(".m-hl")).toHaveCount(1);
    const [from, to] = [8, 26];
    // Screen positions of characters [from, to) of paragraph 2, then a real mouse drag from one to the other.
    const pts = await page.evaluate(
      ({ from, to }) => {
        const text = document.querySelector('.blk[data-block="p2"] .blk-text')!;
        const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
        const at = (k: number, side: "left" | "right") => {
          let o = 0;
          let n: Node | null;
          while ((n = walker.nextNode())) {
            const len = n.textContent!.length;
            const lo = side === "left" ? k : k - 1;
            if (lo < o + len) {
              const r = document.createRange();
              r.setStart(n, lo - o);
              r.setEnd(n, lo - o + 1);
              const b = r.getBoundingClientRect();
              walker.currentNode = text;
              return { x: side === "left" ? b.left + 1 : b.right - 1, y: b.top + b.height / 2 };
            }
            o += len;
          }
          return null;
        };
        const a = at(from, "left");
        walker.currentNode = text;
        const b = at(to, "right");
        return { a, b };
      },
      { from, to },
    );
    expect(pts.a && pts.b).toBeTruthy();
    await page.mouse.move(pts.a!.x, pts.a!.y);
    await page.mouse.down();
    await page.mouse.move(pts.b!.x, pts.b!.y, { steps: 6 });
    await page.mouse.up();
    const half = textOf("p2").slice(from, to);
    // The lens shows the dragged half as the pending selection (not the whole highlight), and acts on it.
    await expect(page.getByRole("toolbar", { name: "Actions for the selection" })).toBeVisible();
    await page.waitForTimeout(400); // give a wrong replacement of the selection time to happen
    await expect(page.locator(".m-pending")).toHaveText(half);
    await page.keyboard.press("Shift+U");
    const quotes = await page.evaluate(() => (JSON.parse(localStorage.getItem("gloss:v1")!).annotations["sample:on-a-piece-of-chalk"] as { kind: string; anchor: { quote: string } }[]).map((a) => [a.kind, a.anchor.quote]));
    expect(quotes).toContainEqual(["underline", half]);
    // The paragraph is still its own text exactly once (a mark spanning several segments used to give them equal React keys and leave a stale copy of the text behind).
    await expect(page.locator('.blk[data-block="p2"] .blk-text')).toHaveText(textOf("p2"));
    await expect(page.locator(".m-pending")).toHaveCount(0);
    await page.keyboard.press("n");
    const nb = page.getByRole("complementary", { name: "Notebook" });
    await removeAll(nb);
    await expect(page.locator(".m-hl, .m-ul")).toHaveCount(0);
  });

  test("ANNOT-19 (part): Space with the lens open does not start a question, any other letter does", async ({ page }) => {
    await openReader(page);
    await selectInBlock(page, "p3", 0, 25);
    await page.keyboard.press("Space");
    await expect(page.getByLabel("Your question about the selected passage")).toHaveCount(0);
    await expect(page.getByRole("toolbar", { name: "Actions for the selection" }).getByRole("button", { name: "Explain" })).toBeVisible();
    await page.keyboard.press("w");
    await expect(page.getByLabel("Your question about the selected passage")).toHaveValue("w");
  });
});
