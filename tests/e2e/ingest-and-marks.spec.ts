import AxeBuilder from "@axe-core/playwright";
import { strToU8, zipSync } from "fflate";
import { expect, test, type Page } from "@playwright/test";
import { openReader, selectInBlock } from "./helpers";

/**
 * Importing several files at once, a Word file on its own, and reviewing marks from the Library. The browser, the server routes and the
 * stores are the real ones. With a database the server also deduplicates; without one the browser does, so these hold either way.
 */
const stamp = () => Math.random().toString(36).slice(2, 8);
const txt = (title: string, body = `Words that only ${title} has.\n\nA second paragraph of ${title}.`) => ({ name: `${title}.txt`.replace(/\s+/g, "-"), mimeType: "text/plain", buffer: Buffer.from(`# ${title}\n\n${body}`) });
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const wordFile = (title: string) => ({
  name: "report.docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  buffer: Buffer.from(
    zipSync({
      "[Content_Types].xml": strToU8("<Types>wordprocessingml</Types>"),
      "word/styles.xml": strToU8(`<w:styles ${W}><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`),
      "word/document.xml": strToU8(
        `<?xml version="1.0"?><w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${title}</w:t></w:r></w:p><w:p><w:r><w:t>The body of the Word file.</w:t></w:r></w:p></w:body></w:document>`,
      ),
    }),
  ),
});

async function openAddPanel(page: Page) {
  await page.goto("/library");
  await page.getByRole("button", { name: "Add a link, PDF or text" }).click();
  const dialog = page.getByRole("dialog", { name: "Add to the library" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("importing several files at once", () => {
  test("each file gets its own outcome: two are saved, an unreadable one fails with a reason, and the saved ones stay", async ({ page }) => {
    const a = `Batch ${stamp()} alpha`;
    const b = `Batch ${stamp()} beta`;
    const dialog = await openAddPanel(page);
    await dialog.locator('input[type="file"][aria-label="Open PDF, text, Word, EPUB or HTML files"]').setInputFiles([txt(a), txt(b), { name: "picture.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") }]);

    const queue = page.getByRole("region", { name: "File import" });
    await expect(queue).toBeVisible();
    await expect(queue.locator("[data-state='done']")).toHaveCount(2, { timeout: 20_000 });
    const failed = queue.locator("[data-state='failed']");
    await expect(failed).toHaveCount(1);
    await expect(failed).toContainText("picture.gif");
    await expect(failed).toContainText(/Only PDF, text/);
    await expect(failed.getByRole("button", { name: "Try again" })).toHaveCount(0); // retrying a refused kind cannot help
    await expect(queue.getByText("Import finished (3 files)")).toBeVisible();
    await expect(queue.getByRole("status")).toContainText("2 of 3 imported");

    await page.goto("/library");
    await expect(page.getByText(a).first()).toBeVisible();
    await expect(page.getByText(b).first()).toBeVisible();
  });

  test("a file already on the shelf is reported as such, not saved twice; the finished list can be dismissed", async ({ page }) => {
    const title = `Repeat ${stamp()}`;
    // Long enough to be compared by its words (texts under 200 characters are never merged), and with words no other file has.
    const file = txt(title, `${`Unique words of ${title}, so this text can only match itself. `.repeat(6)}\n\nSecond paragraph of the repeated file.`);
    const dialog = await openAddPanel(page);
    const input = dialog.locator('input[type="file"][aria-label="Open PDF, text, Word, EPUB or HTML files"]');
    await input.setInputFiles([file, txt(`Other ${stamp()}`)]);
    const queue = page.getByRole("region", { name: "File import" });
    await expect(queue.locator("[data-state='done']")).toHaveCount(2, { timeout: 20_000 });
    await queue.getByRole("button", { name: "Dismiss the import list" }).click();
    await expect(queue).toHaveCount(0);

    await input.setInputFiles([file, txt(`Third ${stamp()}`)]);
    await expect(queue.locator("[data-state='duplicate']")).toHaveCount(1, { timeout: 20_000 });
    await expect(queue.locator("[data-state='duplicate']")).toContainText("Already in your library");
    await expect(queue.locator("[data-state='duplicate']").getByRole("link", { name: "Open" })).toBeVisible();
    await expect(queue.locator("[data-state='done']")).toHaveCount(1);
  });

  test("the progress list has no accessibility violations while it holds results", async ({ page }) => {
    const dialog = await openAddPanel(page);
    await dialog.locator('input[type="file"][aria-label="Open PDF, text, Word, EPUB or HTML files"]').setInputFiles([txt(`A11y ${stamp()}`), txt(`A11y ${stamp()} b`)]);
    const queue = page.getByRole("region", { name: "File import" });
    await expect(queue.locator("[data-state='done']")).toHaveCount(2, { timeout: 20_000 });
    const r = await new AxeBuilder({ page }).include('section[aria-label="File import"]').analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
  });
});

test.describe("a Word file on its own", () => {
  test("is read into a text and opens in the reader, titled by its first heading", async ({ page }) => {
    const title = `Report ${stamp()}`;
    await page.goto("/");
    await page.locator('input[type="file"][aria-label="Open files"]').setInputFiles(wordFile(title));
    await expect(page).toHaveURL(/\/read\//, { timeout: 20_000 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page.getByText("The body of the Word file.")).toBeVisible();
  });

  test("a file that only claims to be Word is refused with a reason and nothing is saved", async ({ page }) => {
    await page.goto("/");
    await page.locator('input[type="file"][aria-label="Open files"]').setInputFiles({ name: "fake.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("plain text, not a zip") });
    await expect(page.getByText(/not a valid Word document/).first()).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("reviewing marks from the Library", () => {
  async function mark(page: Page, block: string, from: number, to: number, key: "Shift+H" | "Shift+U") {
    await selectInBlock(page, block, from, to);
    await page.keyboard.press(key);
  }

  test("every highlight and underline is listed under its text, told apart by name, filterable, openable at the passage and removable", async ({ page }) => {
    await openReader(page);
    await mark(page, "p2", 0, 40, "Shift+H");
    await expect(page.locator(".m-hl")).toHaveCount(1);
    await mark(page, "p3", 0, 30, "Shift+U");
    await expect(page.locator(".m-ul")).toHaveCount(1);

    await page.goto("/library");
    const review = page.locator("[data-marks-review]");
    await expect(review).toBeVisible();
    await expect(review.getByRole("heading", { name: /Your marks/ })).toContainText("2");
    const group = review.locator("[data-marks-doc='on-a-piece-of-chalk']");
    await expect(group.locator("[data-mark-kind='highlight']")).toContainText("Highlight (yellow)");
    await expect(group.locator("[data-mark-kind='underline']")).toContainText("Underline");

    // Filter by kind: the other kind goes away, and a kind with none cannot be chosen.
    await review.getByRole("radio", { name: /^Underlines/ }).click();
    await expect(group.locator("[data-mark-kind]")).toHaveCount(1);
    await expect(group.locator("[data-mark-kind='underline']")).toBeVisible();
    await expect(review.getByRole("radio", { name: /^Notes/ })).toBeDisabled();
    await review.getByRole("radio", { name: /^All/ }).click();

    // Open at the passage: the reader opens with the mark it was asked for.
    await group.locator("[data-mark-kind='highlight']").getByRole("link", { name: "Open at this passage" }).click();
    await expect(page).toHaveURL(/\/read\/on-a-piece-of-chalk\?hl=/);
    await expect(page.locator(".m-hl")).toHaveCount(1);
    await page.goBack();

    // Removing needs a second, explicit step; keeping leaves it as it was.
    const underline = review.locator("[data-mark-kind='underline']");
    await underline.getByRole("button", { name: /Remove this underline/ }).click();
    await underline.getByRole("button", { name: "Keep" }).click();
    await expect(review.locator("[data-mark-kind]")).toHaveCount(2);
    await underline.getByRole("button", { name: /Remove this underline/ }).click();
    await underline.getByRole("button", { name: "Remove mark" }).click();
    await expect(review.locator("[data-mark-kind]")).toHaveCount(1);
    await expect(review.locator("[data-mark-kind='highlight']")).toBeVisible(); // the other mark stays

    // Only the mark went: the text is still on the shelf and still readable.
    await page.goto("/read/on-a-piece-of-chalk");
    await expect(page.locator(".m-ul")).toHaveCount(0);
    await expect(page.locator(".m-hl")).toHaveCount(1);
  });

  test("with no marks the review is not shown at all", async ({ page }) => {
    await page.goto("/library");
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem("gloss:v1") ?? "{}");
      s.annotations = {};
      localStorage.setItem("gloss:v1", JSON.stringify(s));
    });
    await page.route("**/api/documents/*/data", (route) => route.fulfill({ json: { persisted: false } }));
    await page.reload();
    await expect(page.locator("[data-marks-review]")).toHaveCount(0);
  });

  test("the review has no accessibility violations", async ({ page }) => {
    await openReader(page);
    await mark(page, "p2", 0, 40, "Shift+H");
    await expect(page.locator(".m-hl")).toHaveCount(1);
    await page.goto("/library");
    await expect(page.locator("[data-marks-review]")).toBeVisible();
    const r = await new AxeBuilder({ page }).include("[data-marks-review]").analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.target.join(" ")}`)).toEqual([]);
  });
});
