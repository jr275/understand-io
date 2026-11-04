import { expect, test } from "@playwright/test";
import { collectErrors, openReader, selectInBlock } from "./helpers";

test.describe("reader", () => {
  test("loads a sample with header, numbered blocks, composer and no console errors", async ({ page }) => {
    const errors = collectErrors(page);
    await openReader(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("On a Piece of Chalk");
    await expect(page.getByText("Thomas Henry Huxley")).toBeVisible();
    await expect(page.getByRole("link", { name: /Original/ })).toHaveAttribute("href", /gutenberg/);
    await expect(page.locator(".blk[data-n]")).toHaveCount(63);
    await expect(page.locator(".blk[data-type=h2]")).toHaveText("Notes");
    await expect(page.getByLabel("Ask anything about the whole text")).toBeVisible();
    // Reading time matches the reference rounding and the margin shows its empty-state hint.
    await expect(page.getByText("38 min read")).toBeVisible();
    await expect(page.locator(".rg-margin")).toContainText("This area is for notes.");
    await page.waitForTimeout(800);
    expect(errors.filter((e) => !e.includes("favicon"))).toEqual([]);
  });

  test("selecting text shows the lens; highlighting persists across reload and shows in the notebook", async ({ page }) => {
    await openReader(page);
    await selectInBlock(page, "p2", 0, 40);
    const lens = page.getByRole("toolbar", { name: "Actions for the selection" });
    await expect(lens.getByRole("button", { name: "Explain" })).toBeVisible();
    await lens.getByRole("button", { name: "Highlight", exact: true }).hover();
    await lens.getByRole("button", { name: "Highlight in green" }).click();
    await expect(page.locator(".m-hl[data-c=green]")).toHaveText("Not only here, but over the whole county");
    await page.reload();
    await expect(page.locator(".m-hl[data-c=green]")).toHaveText("Not only here, but over the whole county");
    await page.keyboard.press("n");
    const nb = page.getByRole("complementary", { name: "Notebook" });
    await expect(nb).toBeVisible();
    await expect(nb.getByText("Highlight", { exact: true })).toBeVisible();
    await expect(nb.getByText("Not only here, but over the whole county")).toBeVisible();
    await nb.getByRole("button", { name: "Remove" }).click({ force: true });
    await expect(page.locator(".m-hl")).toHaveCount(0);
  });

  test("underline and note annotations are created, shown in the margin and deletable", async ({ page }) => {
    await openReader(page);
    await selectInBlock(page, "p3", 0, 25);
    await page.getByRole("toolbar").getByRole("button", { name: "Underline" }).click({ force: true });
    await expect(page.locator(".m-ul")).toHaveCount(1);
    await selectInBlock(page, "p4", 0, 30);
    await page.getByRole("toolbar").getByRole("button", { name: "Add a note" }).click({ force: true });
    await page.getByLabel("Your note on the selected passage").fill("Remember this bit");
    await page.keyboard.press("Enter");
    await expect(page.locator(".m-note")).toHaveCount(1);
    const note = page.getByRole("button", { name: /Note on paragraph 4/ });
    await expect(note).toContainText("Remember this bit");
    await page.reload();
    await expect(page.locator(".m-ul")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /Note on paragraph 4/ })).toContainText("Remember this bit");
    // Edit the note.
    await page.getByRole("button", { name: /Note on paragraph 4/ }).click();
    await page.getByRole("button", { name: /Note on paragraph 4/ }).click();
    await page.getByLabel("Edit note").fill("Edited note");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /Note on paragraph 4/ })).toContainText("Edited note");
    // The note stays active after editing, so its Delete control is already showing.
    await page.getByRole("button", { name: "Delete note" }).click();
    await expect(page.locator(".m-note")).toHaveCount(0);
  });

  test("asking without a provider key shows an honest error in the margin", async ({ page }) => {
    await openReader(page);
    await page.evaluate(() => localStorage.removeItem("gloss:key"));
    await selectInBlock(page, "p5", 0, 40);
    await page.getByRole("toolbar").getByRole("button", { name: "Explain" }).click();
    const card = page.locator("article.gloss.is-active");
    await expect(card).toBeVisible();
    await expect(card).toContainText(/Together AI key/);
    await expect(page.locator(".m-gloss")).toHaveCount(1);
  });

  test("deleting a gloss stays deleted after reload; clicking the backdrop closes dialogs", async ({ page }) => {
    await openReader(page);
    await page.evaluate(() => localStorage.removeItem("gloss:key"));
    await selectInBlock(page, "p6", 0, 30);
    await page.getByRole("toolbar").getByRole("button", { name: "Simplify" }).click();
    const card = page.locator("article.gloss.is-active");
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator("article.gloss")).toHaveCount(0);
    await page.reload();
    await page.locator("[data-reader-ready]").waitFor({ state: "attached" });
    await page.waitForTimeout(600); // give the server sync a moment to merge
    await expect(page.locator("article.gloss")).toHaveCount(0);
    await expect(page.locator(".m-gloss")).toHaveCount(0);
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.mouse.click(20, 400);
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
  });

  test("keyboard: J/K move the cursor, ? opens keys, F toggles focus, Esc steps back", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("j");
    await expect(page.locator(".blk.is-cursor")).toHaveAttribute("data-block", "p1");
    await page.keyboard.press("j");
    await expect(page.locator(".blk.is-cursor")).toHaveAttribute("data-block", "p2");
    await page.keyboard.press("k");
    await expect(page.locator(".blk.is-cursor")).toHaveAttribute("data-block", "p1");
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
    await page.keyboard.press("f");
    await expect(page.locator(".focus-mode")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".focus-mode")).toHaveCount(0);
  });

  test("appearance: typeface and size apply to the html element", async ({ page }) => {
    await openReader(page);
    await page.getByRole("button", { name: "Appearance and answers" }).click();
    await page.getByRole("radio", { name: "Text" }).click();
    await page.getByRole("button", { name: /Book/ }).click();
    await expect(page.locator("html")).toHaveAttribute("data-face", "book");
    await page.getByRole("button", { name: "Larger text" }).click();
    await expect(page.locator("html")).toHaveAttribute("style", /--read-size: 21px/);
  });

  test("unknown slug shows the not-found state", async ({ page }) => {
    await page.goto("/read/does-not-exist-xyz");
    await expect(page.getByText("Not on your shelves.")).toBeVisible();
  });

  test("more ways in: top-bar Add opens the panel, the end-of-text strip imports a pasted text, drop imports a file", async ({ page }) => {
    await openReader(page);
    await page.getByRole("button", { name: "Add a link, PDF or text" }).click();
    const dialog = page.getByRole("dialog", { name: "Add to the library" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Upload files" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    const strip = page.getByRole("region", { name: "Read something else" });
    await strip.scrollIntoViewIfNeeded();
    await strip.getByRole("button", { name: "Paste text" }).click();
    await page.getByRole("dialog", { name: "Paste text" }).getByLabel("Text to read").fill("# From the footer\n\nOne more paragraph to read.\n\nAnd a second one.");
    await page.getByRole("dialog", { name: "Paste text" }).getByRole("button", { name: "Read" }).click();
    await expect(page).toHaveURL(/\/read\/from-the-footer-/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("From the footer");

    // Drop a markdown file anywhere on the page.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["# Dropped\n\nA dropped file becomes a text.\n\nSecond paragraph."], "dropped.md", { type: "text/markdown" }));
      window.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
    });
    await expect(page.getByText("Drop to read")).toBeVisible();
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(["# Dropped\n\nA dropped file becomes a text.\n\nSecond paragraph."], "dropped.md", { type: "text/markdown" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect(page).toHaveURL(/\/read\/dropped-/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dropped");
  });
});

test.describe("single-key shortcuts can be switched off (WCAG 2.1.4)", () => {
  test("with the setting on, N opens the notebook and a letter after selecting starts a question", async ({ page }) => {
    await openReader(page);
    await page.keyboard.press("n");
    await expect(page.getByRole("complementary", { name: "Notebook" })).toBeVisible();
    await page.keyboard.press("Escape");
    await selectInBlock(page, "p2", 0, 30);
    await page.keyboard.press("x");
    await expect(page.getByLabel("Your question about the selected passage")).toHaveValue("x");
  });

  test("with the setting off, single letters do nothing, Escape and buttons still work, and the switch is in Appearance", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("gloss:settings", JSON.stringify({ keys: false })));
    await openReader(page);
    for (const k of ["n", "l", "v", "j", "f", "?"]) await page.keyboard.press(k);
    await expect(page.getByRole("complementary", { name: "Notebook" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Reading aloud" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Ask by voice" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toHaveCount(0);
    await expect(page.locator("html.focus-mode, .focus-mode").first()).toHaveCount(0);
    await selectInBlock(page, "p2", 0, 30);
    await page.keyboard.press("x");
    const lens = page.getByRole("toolbar", { name: "Actions for the selection" });
    await expect(lens).toBeVisible();
    await expect(lens.getByRole("button", { name: "Explain" })).toBeVisible(); // still on the bar: no question started by the letter
    await expect(page.getByLabel("Your question about the selected passage")).toHaveCount(0);
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click(); // the button still opens the list
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Appearance and answers" }).click();
    const sw = page.getByRole("switch", { name: /Single-key shortcuts/ });
    await expect(sw).not.toBeChecked();
    await sw.click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.locator("body").click({ position: { x: 5, y: 300 } });
    await page.keyboard.press("?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible(); // back on
  });
});
