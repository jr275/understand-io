import { expect, test, type Page } from "@playwright/test";

/**
 * The whole path in Portuguese, from an English browser that only opened a /pt-BR address: home → several links → library → reader → the Understand panel
 * (the model's answer stood in for). After each screen, the interface text (not the reader's own text or the model's answer) must hold no English
 * interface phrase. The same path in English is checked for the opposite leak.
 */
const priv = (n: string) => `http://127.0.0.1/journey/${n}`;
const EN_UI = /\b(Library|Notebook|Highlights?|Underline|Quick summary|Ask about|Paste text|Open files|Read aloud|Appearance|Sign in|Add content|Regenerate|Finished|Make something|Search the library|Your library)\b/;
const PT_UI = /\b(Biblioteca|Caderno|Destaques?|Sublinhado|Resumo rápido|Perguntar|Colar texto|Abrir arquivos|Ler em voz alta|Aparência|Entrar|Adicionar conteúdo|Concluído)\b/;

/** The text of the interface: the page without the reading text and without the model's answers. */
const interfaceText = (page: Page) =>
  page.evaluate(() => {
    const clone = document.body.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".prose-read, [data-insight], script, style, nextjs-portal").forEach((n) => n.remove());
    const labels = [...clone.querySelectorAll("[aria-label],[title],[placeholder],[data-tip]")].map((n) => ["aria-label", "title", "placeholder", "data-tip"].map((a) => n.getAttribute(a) ?? "").join(" "));
    return `${clone.innerText}\n${labels.join("\n")}`;
  });

function summary(sent: { variant?: string; totalParagraphs: number; blocks: { id: string; n?: number; text: string }[] }) {
  const real = sent.blocks.find((b) => b.n && b.text.length > 60)!;
  return {
    kind: "summary",
    variant: sent.variant ?? "quick",
    items: [{ text: "The first real paragraph says something specific.", basis: "text", evidence: [{ blockId: real.id, n: real.n, quote: real.text.slice(0, 48), start: 0, end: 48 }] }],
    caveats: [],
    coverage: { used: sent.blocks.filter((b) => b.n).length, total: sent.totalParagraphs, from: 1, to: sent.blocks.filter((b) => b.n).length, complete: true },
  };
}

test("Portuguese: a visitor who opened /pt-BR in an English browser keeps Portuguese through import, library, reader and the Understand panel", async ({ page, context }) => {
  await page.route("**/api/ai", (route) => route.fulfill({ json: { result: summary(route.request().postDataJSON()), model: "test/model", usage: { input: 1, output: 1, cost: 0 } } }));

  // Home: several links, one per line.
  await page.goto("/pt-BR");
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  const box = page.getByRole("textbox", { name: "Links dos artigos" });
  await expect(box).toHaveAttribute("data-hydrated", "");
  await box.fill([priv("um"), priv("dois"), priv("tres")].join("\n"));
  await page.getByRole("button", { name: /^Ler links/ }).click();
  await expect(page.getByText(/Concluído: 3 importados, 0 já na sua biblioteca, 0 falharam, 0 ignorados\./)).toBeVisible();
  expect(await interfaceText(page)).not.toMatch(EN_UI);
  expect((await context.cookies()).find((c) => c.name === "gloss_lang")?.value).toBe("pt-BR"); // opening the Portuguese address chose it

  // Library: an address with no language in it, still Portuguese.
  await page.getByRole("link", { name: "Abrir a sua biblioteca" }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  await expect(page.locator("button.bk")).toHaveCount(3 + 3);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("biblioteca");
  expect(await interfaceText(page)).not.toMatch(EN_UI);

  // Reader.
  await page.goto("/read/on-a-piece-of-chalk");
  await page.locator("[data-reader-ready]").waitFor({ state: "attached" });
  await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
  expect(await interfaceText(page)).not.toMatch(EN_UI);

  // The Understand panel, with a summary.
  await page.keyboard.press("i");
  const panel = page.getByRole("complementary", { name: "Entender" });
  await expect(panel).toBeVisible();
  const make = panel.getByRole("region", { name: "Criar algo" });
  const quick = make.getByRole("button", { name: /^Resumo rápido/ });
  if (!(await quick.isVisible())) await make.getByRole("button", { name: "Criar algo novo" }).click();
  await quick.click();
  await expect(panel.locator("[data-insight]").first().getByRole("heading", { name: "Resumo rápido" })).toBeVisible();
  expect(await interfaceText(page)).not.toMatch(EN_UI);
});

test("English: the same path from the English address holds no Portuguese interface phrase", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("textbox", { name: "Article links" });
  await expect(box).toHaveAttribute("data-hydrated", "");
  await box.fill([priv("one"), priv("two")].join("\n"));
  await page.getByRole("button", { name: /^Read links/ }).click();
  await expect(page.getByText(/Finished: 2 imported/)).toBeVisible();
  expect(await interfaceText(page)).not.toMatch(PT_UI);
  await page.getByRole("link", { name: "Open your library" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(await interfaceText(page)).not.toMatch(PT_UI);
  await page.goto("/read/on-a-piece-of-chalk");
  await page.locator("[data-reader-ready]").waitFor({ state: "attached" });
  expect(await interfaceText(page)).not.toMatch(PT_UI);
});
