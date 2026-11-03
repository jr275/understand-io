import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { collectErrors, settleAnimations } from "./helpers";

/**
 * Every way to add content, in both languages: the link field on the home page, the "Add content" button in the top bar, "Add a source" in the
 * library, and the file upload next to them. They all go through the one import pipeline (`/api/import`, `/api/import/file`), so what is checked here
 * is that each entry point is visible, validates before sending, says what it is doing, and ends where the reader expects.
 * The links point at a private address on purpose: the server refuses to fetch it, so it is saved as a link card and the test needs no network.
 */
const UNREADABLE = "http://127.0.0.1/reports/annual-report";

const T = {
  en: { path: "/", field: /Article links?/, add: "Add content", invalid: /does not look like a web address/, retry: "Try again", offline: /Could not reach the server/, library: "/library", source: "Add a source", already: /already in your library/, saved: /Saved as a link only/ },
  pt: { path: "/pt-BR", field: /Links? d[oa]s? artigos?/, add: "Adicionar conteúdo", invalid: /não parece um endereço da web/, retry: "Tentar de novo", offline: /Não foi possível acessar o servidor/, library: "/pt-BR/library", source: "Adicionar uma fonte", already: /já está na sua biblioteca/, saved: /Salvo apenas como link/ },
} as const;

const linkField = (page: Page | Locator, label: string | RegExp) => page.getByRole("textbox", { name: label });
/** The sentence under a link field (the toast that repeats it is a separate status region). */
const status = (scope: Page | Locator) => scope.locator("[data-url-status]");
const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`);

test.describe("home: the link field is the first thing on the page", () => {
  test("it is inside the first screen on a laptop and on a phone, with a labelled button", async ({ page }) => {
    for (const size of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      await page.goto("/");
      const box = await linkField(page, /Article links?/).boundingBox();
      expect(box, `${size.width}px`).not.toBeNull();
      expect(box!.y + box!.height, `${size.width}px: the field ends inside the first screen`).toBeLessThan(size.height);
      await expect(page.getByRole("button", { name: /^Read/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Read/ })).toContainText("Read"); // a word, also on a phone
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
  });

  for (const lang of ["en", "pt"] as const) {
    const L = T[lang];
    test(`${lang}: text that is not an address is explained and never sent; an empty field sends focus there`, async ({ page }) => {
      let sent = 0;
      await page.route("**/api/import", (r) => (sent++, r.continue()));
      await page.goto(L.path);
      const field = linkField(page, L.field);
      await page.getByRole("button", { name: /^(Read|Ler)/ }).click();
      await expect(field).toBeFocused();
      await field.fill("not a link at all");
      await field.press("Enter");
      await expect(status(page)).toContainText(L.invalid);
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await field.fill("mailto:someone@example.com");
      await field.press("Enter");
      await expect(status(page)).toContainText(lang === "en" ? "Only http and https" : "Só links http e https");
      expect(sent).toBe(0);
    });

    test(`${lang}: a failed request says so, keeps the address, and Try again completes it`, async ({ page }) => {
      const errors = collectErrors(page);
      let calls = 0;
      await page.route("**/api/import", (r) => (calls++ === 0 ? r.abort("connectionfailed") : r.continue()));
      await page.goto(L.path);
      await linkField(page, L.field).fill(UNREADABLE);
      await linkField(page, L.field).press("Enter");
      await expect(status(page)).toContainText(L.offline);
      await expect(linkField(page, L.field)).toHaveValue(UNREADABLE);
      await page.getByRole("button", { name: L.retry }).click();
      await expect(page.locator("[data-link-page]")).toBeVisible();
      expect(calls).toBe(2);
      expect(errors.filter((e) => !/Failed to load resource|connectionfailed|ERR_FAILED|request failed: .*\/api\/import$/.test(e))).toEqual([]);
    });
  }
});

test.describe("the Add content button and the library's Add a source open the same panel", () => {
  for (const lang of ["en", "pt"] as const) {
    const L = T[lang];

    test(`${lang}: top bar → link added without leaving the page, and the field is ready for the next one`, async ({ page }) => {
      await page.goto(L.path);
      await page.getByRole("button", { name: L.add }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // The address field is where the keyboard already is, and the file upload is a separate, named place next to it.
      await expect(linkField(dialog, L.field)).toBeFocused();
      await expect(dialog.getByRole("button", { name: lang === "en" ? "Upload files" : "Enviar arquivos" })).toBeVisible();
      const url = L.path;
      await linkField(dialog, L.field).fill(UNREADABLE);
      await linkField(dialog, L.field).press("Enter");
      await expect(status(dialog)).toContainText(L.saved);
      expect(new URL(page.url()).pathname).toBe(url); // still on the page it was opened from
      await expect(linkField(dialog, L.field)).toHaveValue("");
      // A link whose page could not be read is never called a duplicate (the reader may be trying again): the same address is accepted again.
      await linkField(dialog, L.field).fill(UNREADABLE);
      await linkField(dialog, L.field).press("Enter");
      await expect(status(dialog)).toContainText(L.saved);
      await expect(dialog.getByRole("link", { name: lang === "en" ? "Open" : "Abrir" })).toBeVisible();
    });

    test(`${lang}: library → Add a source → the new link is on the shelf, and a file uploaded from the same panel is read`, async ({ page }) => {
      await page.goto(L.library);
      const shelf = page.locator("button.bk");
      const before = await shelf.count();
      await page.getByRole("button", { name: new RegExp(L.source) }).click();
      const dialog = page.getByRole("dialog");
      await linkField(dialog, L.field).fill("http://127.0.0.1/library-added");
      await linkField(dialog, L.field).press("Enter");
      await expect(status(dialog)).toContainText(L.saved);
      await page.keyboard.press("Escape");
      await expect(shelf).toHaveCount(before + 1);
      expect(new URL(page.url()).pathname).toBe(L.library);
      // A single file opens straight away, as it does from the home page: the same upload, the same pipeline.
      await page.getByRole("button", { name: new RegExp(L.source) }).click();
      const text = `Understand ${lang} upload ${Date.now()}. ` + "A short paragraph of plain text that is long enough to be read as a document. ".repeat(6);
      await page.getByRole("dialog").locator('input[type="file"][multiple]').setInputFiles({ name: `note-${lang}.txt`, mimeType: "text/plain", buffer: Buffer.from(text) });
      await expect(page).toHaveURL(/\/read\/note-/);
      await page.goto(L.library);
      await expect(shelf).toHaveCount(before + 2);
    });

    test(`${lang}: the panel passes axe and fits a phone`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(L.library);
      await page.getByRole("button", { name: new RegExp(L.source) }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await settleAnimations(page);
      expect(await axe(page)).toEqual([]);
      const dialogBox = await page.getByRole("dialog").boundingBox();
      expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(390.5);
    });
  }
});

test.describe("the top bar keeps every control on screen on a phone", () => {
  for (const lang of ["en", "pt"] as const) {
    for (const width of [360, 390]) {
      test(`${lang} at ${width}px: Add content, language and account are all inside the screen`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        for (const path of [T[lang].path, T[lang].library]) {
          await page.goto(path);
          await expect(page.getByRole("button", { name: T[lang].add })).toBeVisible();
          const right = await page.evaluate(() => Math.max(...[...document.querySelectorAll("header nav > *")].map((el) => el.getBoundingClientRect().right)));
          expect(right, `${path}: the last control ends at ${right}px`).toBeLessThanOrEqual(width);
        }
      });
    }
  }
});

test("the Portuguese title stays on two lines, so the link field is still in the first screen", async ({ page }) => {
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size);
    await page.goto("/pt-BR");
    const lines = await page.evaluate(() => {
      const h = document.querySelector("h1")!;
      return Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight));
    });
    expect(lines, `${size.width}px`).toBe(2);
    const box = await page.getByRole("textbox", { name: /Links? d[oa]s? artigos?/ }).boundingBox();
    expect(box!.y + box!.height).toBeLessThan(size.height * 0.65);
  }
});

test("a link that fails or is added inside the panel is said once, next to the field, without a second toast", async ({ page }) => {
  await page.goto("/library");
  await page.getByRole("button", { name: /Add a source/ }).click();
  const dialog = page.getByRole("dialog");
  await linkField(dialog, /Article links?/).fill("http://127.0.0.1/no-toast");
  await linkField(dialog, /Article links?/).press("Enter");
  await expect(status(dialog)).toContainText("Saved as a link only");
  await expect(page.locator('[role="status"]:not([data-url-status])').filter({ hasText: /Saved the link|Shelved/ })).toHaveCount(0);
});
