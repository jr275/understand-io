// The two languages in a real browser: detection, the language switcher, persistence, switching without losing the reading session, locale metadata,
// layout in both languages on desktop and phone, and accessibility of the Portuguese page.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SAMPLE, collectErrors, openReader, selectInBlock, settleAnimations } from "./helpers";

const switcher = (page: Page) => page.getByRole("group", { name: /^(Language|Idioma)$/ });
const option = (page: Page, name: "English" | "Português (Brasil)") => switcher(page).getByRole("button", { name: new RegExp(name.replace(/[()]/g, "\\$&")) });
const choose = (page: Page, name: "English" | "Português (Brasil)") => option(page, name).click();
const noHorizontalScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

test.describe("English is the default and Portuguese has its own addresses", () => {
  test("/ is English: html lang, hero, title, switcher", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Highlight any line.");
    await expect(page).toHaveTitle(/highlight any line and ask it anything/i);
    await expect(option(page, "English")).toHaveAttribute("aria-pressed", "true");
    expect(errors).toEqual([]);
  });

  test("/pt-BR is Portuguese: html lang, hero, title, every control of the landing page", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/pt-BR");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Destaque qualquer trecho.");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Pergunte o que quiser.");
    await expect(page).toHaveTitle(/destaque qualquer trecho e pergunte o que quiser/i);
    await expect(page.getByPlaceholder("Cole o link de qualquer artigo")).toBeVisible();
    await expect(page.getByRole("button", { name: "Abrir arquivos" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Colar texto" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Biblioteca", exact: true })).toBeVisible();
    await expect(page.getByText("Como funciona")).toBeVisible();
    await expect(page.getByText("Cole um link")).toBeVisible();
    await expect(option(page, "Português (Brasil)")).toHaveAttribute("aria-pressed", "true");
    // nothing English left on the page except the product's own name and the samples' titles
    const body = await page.locator("main").innerText();
    for (const english of ["How it works", "Paste a link", "Select any line", "Open files", "Highlight any", "Ask it anything"]) expect(body).not.toContain(english);
    expect(errors).toEqual([]);
  });

  test("the paste dialog and its counter speak Portuguese, with the plural of the language", async ({ page }) => {
    await page.goto("/pt-BR");
    await page.getByRole("button", { name: "Colar texto" }).click();
    const dialog = page.getByRole("dialog", { name: "Colar texto" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Um capítulo, um ensaio, anotações.")).toBeVisible();
    await dialog.getByLabel("Texto para ler").fill("uma palavra");
    await expect(dialog.getByText("2 palavras")).toBeVisible();
    await dialog.getByLabel("Texto para ler").fill("palavra");
    await expect(dialog.getByText("1 palavra", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Fechar" }).click();
  });

  test("the Portuguese page names both languages to search engines when it knows its address (hreflang, canonical, locale)", async ({ request }) => {
    const html = await (await request.get("/pt-BR")).text();
    expect(html).toMatch(/<html[^>]*lang="pt-BR"/);
    // Without APP_URL (this test server) no absolute address is known and none is invented; the Open Graph locale is still declared.
    expect(html).toMatch(/property="og:locale" content="pt_BR"/);
    expect(html).not.toMatch(/hreflang="x-default" href="[^h]/);
  });
});

test.describe("choosing, remembering and detecting", () => {
  test("choosing Portuguese on the landing page moves to /pt-BR, is remembered, and brings the reader back there from /", async ({ page, context }) => {
    await page.goto("/");
    await choose(page, "Português (Brasil)");
    await expect(page).toHaveURL(/\/pt-BR$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Destaque qualquer trecho.");
    expect((await context.cookies()).find((c) => c.name === "gloss_lang")?.value).toBe("pt-BR");
    await page.goto("/");
    await expect(page).toHaveURL(/\/pt-BR$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await choose(page, "English");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Highlight any line.");
    await page.goto("/");
    await expect(page).not.toHaveURL(/pt-BR/); // the explicit choice of English is remembered too
  });

  test("the app's own pages follow the saved choice and need no prefix", async ({ page, context }) => {
    await context.addCookies([{ name: "gloss_lang", value: "pt-BR", url: "http://localhost:3100" }]);
    await page.goto("/library");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByRole("link", { name: "Biblioteca", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/library$/);
  });

  test("a browser that asks for Portuguese gets the Portuguese app, but an indexed page is not moved without a choice", async ({ browser }) => {
    const ctx = await browser.newContext({ locale: "pt-BR" });
    const page = await ctx.newPage();
    await page.goto("/library");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await ctx.close();
    const en = await browser.newContext({ locale: "en-US" });
    const p2 = await en.newPage();
    await p2.goto("/library");
    await expect(p2.locator("html")).toHaveAttribute("lang", "en");
    await en.close();
  });
});

test.describe("switching keeps the reading session", () => {
  test("language change in the reader keeps the text, the scroll position, the highlight and the open panel", async ({ page }) => {
    await openReader(page);
    await selectInBlock(page, "p2", 0, 40);
    await page.keyboard.press("Shift+H");
    await expect(page.locator(".m-hl")).toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, 600));
    const before = await page.evaluate(() => window.scrollY);
    const title = await page.locator("h1").first().innerText();
    await page.getByRole("button", { name: "Appearance and answers" }).click();
    await expect(page.getByText("Theme", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await choose(page, "Português (Brasil)");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.getByRole("button", { name: "Aparência e respostas" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${SAMPLE}$`)); // the address did not change
    await expect(page.locator(".m-hl")).toHaveCount(1); // nothing was reloaded away
    expect(await page.locator("h1").first().innerText()).toBe(title);
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThan(40);
    await page.getByRole("button", { name: "Aparência e respostas" }).click();
    await expect(page.getByText("Tema", { exact: true })).toBeVisible();
    await expect(page.getByText("Theme", { exact: true })).toHaveCount(0);

    await choose(page, "English");
    await expect(page.getByRole("button", { name: "Appearance and answers" })).toBeVisible();
    await expect(page.locator(".m-hl")).toHaveCount(1);
  });
});

test.describe("layout and accessibility in both languages", () => {
  for (const [path, label] of [["/", "English"], ["/pt-BR", "Portuguese"]] as const) {
    for (const width of [360, 390, 768, 1280]) {
      test(`${label} landing page fits at ${width}px without horizontal scrolling`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await noHorizontalScroll(page);
        await expect(switcher(page)).toBeVisible();
      });
    }
  }

  test("the Portuguese reader's top bar fits on a phone", async ({ page, context }) => {
    await context.addCookies([{ name: "gloss_lang", value: "pt-BR", url: "http://localhost:3100" }]);
    await page.setViewportSize({ width: 360, height: 800 });
    await openReader(page);
    await noHorizontalScroll(page);
    await expect(page.getByRole("button", { name: "Aparência e respostas" })).toBeVisible();
  });

  test("the Portuguese landing page has no accessibility violations", async ({ page }) => {
    await page.goto("/pt-BR");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await settleAnimations(page);
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 120)}`)).toEqual([]);
  });

  test("the language switcher is operable by keyboard and each option is named in its own language", async ({ page }) => {
    await page.goto("/pt-BR");
    await expect(option(page, "English")).toHaveAttribute("lang", "en");
    await expect(option(page, "Português (Brasil)")).toHaveAttribute("lang", "pt-BR");
    await option(page, "English").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/$/);
  });
});
