import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";

/** The library as one body of knowledge: search every text and note, back it all up, and never keep the same text twice. */

async function openLibrary(page: Page) {
  await page.goto("/library");
  await expect(page.locator("button.bk")).toHaveCount(3);
}

test.describe("searching the whole library", () => {
  test("a question finds the passage in the right text, with the paragraph, and opens the text on it marked", async ({ page }) => {
    await openLibrary(page);
    await page.getByLabel("Search the library").fill("substitute for thought");
    const results = page.getByTestId("library-search");
    await expect(results).toBeVisible();
    await expect(results.getByRole("status")).toContainText(/passages? in 1 text\./);
    // The best passage comes first, in the right text.
    const first = results.getByRole("link").first();
    await expect(first).toContainText("On Thinking for Oneself");
    await expect(first).toContainText("¶7");
    await expect(first).toContainText("substitute for thought of one");
    await expect(first.locator("mark")).not.toHaveCount(0);
    await first.click();
    await page.waitForURL(/\/read\/on-thinking-for-oneself\?at=p7&s=\d+&e=\d+/);
    await expect(page.locator(".hit-mark").first()).toBeVisible();
    await expect(page.locator(".hit-mark").first()).toContainText(/substitute/);
  });

  test("a question no text covers says so, and names how many texts were searched", async ({ page }) => {
    await openLibrary(page);
    await page.getByLabel("Search the library").fill("quantum chromodynamics");
    await expect(page.getByTestId("library-search").getByRole("status")).toContainText("Nothing in 3 texts mentions “quantum chromodynamics”.");
    await expect(page.getByTestId("library-search").getByRole("link")).toHaveCount(0);
  });

  test("one letter does not search; clearing the box brings the plain shelf back", async ({ page }) => {
    await openLibrary(page);
    await page.getByLabel("Search the library").fill("c");
    await expect(page.getByTestId("library-search")).toHaveCount(0);
    await page.getByLabel("Search the library").fill("globigerina");
    await expect(page.getByTestId("library-search")).toBeVisible();
    await page.getByLabel("Search the library").fill("");
    await expect(page.getByTestId("library-search")).toHaveCount(0);
  });

  test("the reader's own notes and highlights are found by their words and open at the mark", async ({ page }) => {
    await page.addInitScript(() => {
      if (localStorage.getItem("seeded")) return;
      localStorage.setItem("seeded", "1");
      const quote = "Reading is nothing more than a substitute";
      localStorage.setItem(
        "gloss:v1",
        JSON.stringify({
          docs: {},
          progress: {},
          glosses: {},
          hidden: [],
          deleted: [],
          persisted: false,
          annotations: {
            "sample:on-thinking-for-oneself": [
              { id: "note0000001", documentId: "sample:on-thinking-for-oneself", kind: "note", note: "Compare with the xylophone argument", anchor: { start: { b: "p7", o: 0 }, end: { b: "p7", o: quote.length }, quote }, createdAt: 1000, updatedAt: 1000 },
            ],
          },
        }),
      );
      localStorage.setItem("gloss:library-seen", "1");
    });
    await page.goto("/library");
    await page.getByLabel("Search the library").fill("xylophone");
    const marks = page.getByRole("list", { name: "Your marks" });
    await expect(marks).toBeVisible();
    await expect(marks.getByRole("link")).toHaveCount(1);
    await expect(marks).toContainText("Compare with the xylophone argument");
    await marks.getByRole("link").click();
    await page.waitForURL(/\/read\/on-thinking-for-oneself\?hl=note0000001/);
  });
});

test.describe("backup and restore", () => {
  const seed = (page: Page) =>
    page.addInitScript(() => {
      if (localStorage.getItem("seeded")) return;
      localStorage.setItem("seeded", "1");
      const text = "Kites are made of paper and string, and they fly best when the wind is steady and strong. ".repeat(4);
      localStorage.setItem(
        "gloss:v1",
        JSON.stringify({
          docs: { "my-kites": { id: "local:my-kites", slug: "my-kites", kind: "text", title: "My kites", topic: "writing", minutes: 1, paragraphs: 1, blocks: [{ id: "p1", type: "p", text, n: 1 }] } },
          progress: {},
          glosses: {},
          hidden: [],
          deleted: [],
          persisted: false,
          annotations: { "local:my-kites": [{ id: "kite0000001", documentId: "local:my-kites", kind: "highlight", color: "yellow", anchor: { start: { b: "p1", o: 0 }, end: { b: "p1", o: 5 }, quote: "Kites" }, createdAt: 1000, updatedAt: 1000 }] },
        }),
      );
      localStorage.setItem("gloss:library-seen", "1");
    });

  test("a backup downloads with the text and the mark, restores into an empty browser, and restoring twice adds nothing", async ({ page }) => {
    await seed(page);
    await page.goto("/library");
    await expect(page.getByTestId("backup")).toContainText("1 text, 1 mark, 0 questions to back up.");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^keeple-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const path = await download.path();
    const json = JSON.parse(readFileSync(path, "utf8"));
    expect(json).toMatchObject({ app: "understand-io", version: 1 });
    expect(json.docs.map((d: { slug: string }) => d.slug)).toEqual(["my-kites"]);
    expect(json.annotations["local:my-kites"]).toHaveLength(1);

    // A different browser: nothing saved yet.
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("seeded", "1");
      localStorage.setItem("gloss:library-seen", "1");
    });
    await page.reload();
    await expect(page.getByTestId("backup")).toContainText("0 texts, 0 marks");
    await page.getByLabel("Backup file").setInputFiles(path);
    const preview = page.getByRole("region", { name: "Restore preview" });
    await expect(preview).toContainText("adds 1 text, 1 mark and 0 questions");
    await expect(preview).toContainText("Nothing you have is replaced or deleted.");
    await preview.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByTestId("backup")).toContainText("1 text, 1 mark");
    await expect(page.locator("button.bk", { hasText: "My kites" })).toBeVisible();
    await expect(page.getByText(/Restored 1 text and 1 mark/)).toBeVisible();

    // The restored text is searchable and its mark is back.
    await page.getByLabel("Search the library").fill("kites paper string");
    await expect(page.getByTestId("library-search").getByRole("link", { name: /My kites/ }).first()).toBeVisible();

    // The same file again: everything is already here.
    await page.getByLabel("Backup file").setInputFiles(path);
    await expect(page.getByTestId("backup").getByRole("alert")).toContainText("already in your library");
    await expect(page.getByRole("region", { name: "Restore preview" })).toHaveCount(0);
  });

  test("a file that is not a backup is refused with a reason and changes nothing", async ({ page }, info) => {
    await seed(page);
    await page.goto("/library");
    for (const [name, body, reason] of [
      ["notes.json", JSON.stringify({ hello: "world" }), /not a Keeple backup/],
      ["broken.json", "{not json", /not valid JSON/],
      ["evil.json", JSON.stringify({ app: "understand-io", version: 1, exportedAt: "x", docs: [{ slug: "x", kind: "text", title: "x", topic: "t", minutes: 1, paragraphs: 1, blocks: [{ id: "p1", type: "p", text: "t", runs: [{ text: "t", href: "javascript:alert(1)" }] }] }], progress: {}, annotations: {}, glosses: {} }), /damaged/],
    ] as const) {
      await page.getByLabel("Backup file").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(body) });
      await expect(page.getByTestId("backup").getByRole("alert")).toContainText(reason);
      void info;
    }
    await expect(page.getByTestId("backup")).toContainText("1 text, 1 mark");
    // The three samples and the one text: nothing was added or removed.
    await expect(page.locator("button.bk")).toHaveCount(4);
  });

  test("every note exports as one Markdown file", async ({ page }) => {
    await seed(page);
    await page.goto("/library");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Export all notes/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^keeple-notes-.*\.md$/);
    const md = readFileSync(await download.path(), "utf8");
    expect(md).toContain("# My kites");
    expect(md).toContain("Kites");
  });
});

test.describe("the same text is not kept twice", () => {
  test("importing an address already on the shelf opens it instead, whatever tracking is on the link", async ({ page }) => {
    let imports = 0;
    const body = "Gardens need patience, water and light, and a gardener who pays attention to the soil beneath them. ".repeat(3);
    await page.route("**/api/import", async (route) => {
      imports++;
      await route.fulfill({
        json: { persisted: false, document: { slug: "gardens-abc12", kind: "url", title: "On gardens", sourceUrl: "https://example.com/gardens", topic: "writing", minutes: 1, paragraphs: 1, blocks: [{ id: "p1", type: "p", text: body, n: 1 }] } },
      });
    });
    await page.goto("/");
    await page.getByLabel("Article link").fill("https://example.com/gardens");
    await page.getByRole("button", { name: /^Read/ }).click();
    await page.waitForURL(/\/read\/gardens-abc12/);
    expect(imports).toBe(1);

    await page.goto("/");
    await page.getByLabel("Article link").fill("www.example.com/gardens/?utm_source=newsletter#intro");
    await page.getByRole("button", { name: /^Read/ }).click();
    await page.waitForURL(/\/read\/gardens-abc12/);
    await expect(page.getByText(/“On gardens” is already in your library/)).toBeVisible();
    expect(imports).toBe(1);
  });
});

test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`);

  test("search results and the backup panel have no axe violations, in the light and the dark theme", async ({ page }) => {
    await openLibrary(page);
    await page.getByLabel("Search the library").fill("globigerina");
    await expect(page.getByTestId("library-search").getByRole("link").first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.getByLabel("Backup file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from("{nope") });
    await expect(page.getByTestId("backup").getByRole("alert")).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.evaluate(() => localStorage.setItem("gloss:settings", JSON.stringify({ theme: "night" })));
    await page.reload();
    await page.getByLabel("Search the library").fill("globigerina");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "night");
    await expect(page.getByTestId("library-search").getByRole("link").first()).toBeVisible();
    expect(await axe(page)).toEqual([]);
  });

  test("results are reachable and openable with the keyboard alone", async ({ page }) => {
    await openLibrary(page);
    await page.getByLabel("Search the library").fill("substitute for thought");
    await page.getByLabel("Search the library").press("ArrowDown");
    const link = page.getByTestId("library-search").getByRole("link").first();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL(/\?at=p7/);
  });
});
