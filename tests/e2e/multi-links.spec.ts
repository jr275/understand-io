import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import chalk from "../../src/content/samples/on-a-piece-of-chalk.json";
import { settleAnimations } from "./helpers";

/**
 * Several links from the home page, one per line. They go through the real import route and the real database; the links point at private addresses
 * (which the server refuses to fetch, so each is saved as a link card) except where a test needs a readable page or a failure, and then the answer is
 * stood in for with a fixture. Run on the engines listed in `playwright.config.ts` for this file.
 */
const L = {
  en: { path: "/", box: "Article links", read: /^Read links/, hint: "Paste one or multiple links. One link per line.", finished: /Finished: (\d+) imported, (\d+) already in your library, (\d+) failed, (\d+) skipped\./, skipped: /(\d+) lines? (is|are) not (a )?web address/, repeated: /repeated link/, retry: /^Retry (\d+) failed links?/, library: "/library", already: "Already in your library", saved: "Imported" },
  pt: { path: "/pt-BR", box: "Links dos artigos", read: /^Ler links/, hint: "Cole um ou vários links. Um link por linha.", finished: /Concluído: (\d+) importados, (\d+) já na sua biblioteca, (\d+) falharam, (\d+) ignorados\./, skipped: /(\d+) linhas? não (é|são) (um )?endereços? da web/, repeated: /link(s)? repetidos?/, retry: /^Tentar de novo (\d+) links? que falh/, library: "/pt-BR/library", already: "Já está na sua biblioteca", saved: "Importado" },
} as const;
type Lang = keyof typeof L;

const box = (page: Page, lang: Lang) => page.getByRole("textbox", { name: L[lang].box });
const readButton = (page: Page, lang: Lang) => page.getByRole("button", { name: L[lang].read });
const results = (page: Page) => page.locator("[data-link-results]");
const count = (page: Page, name: string) => results(page).locator(`[data-count="${name}"] b`);
const priv = (name: string) => `http://127.0.0.1/batch/${name}`;

/** Every body sent to /api/import, in order, and how many were in flight at once. */
function watchImports(page: Page, answer?: (url: string, route: Route) => Promise<boolean>) {
  const seen = { urls: [] as string[], peak: 0 };
  let inFlight = 0;
  return page.route("**/api/import", async (route) => {
    const url = (route.request().postDataJSON() as { url: string }).url;
    seen.urls.push(url);
    inFlight++;
    seen.peak = Math.max(seen.peak, inFlight);
    try {
      if (answer && (await answer(url, route))) return;
      await route.continue();
    } finally {
      inFlight--;
    }
  }).then(() => seen);
}

/** A readable, saved text for a link, standing in for the server's answer. */
const fixture = (url: string, n: number) => ({
  document: { ...chalk, id: `fx-${n}`, slug: `fx-${n}`, kind: "url", sourceUrl: url, title: `Fixture ${n}` },
  persisted: false,
});

async function fill(page: Page, lang: Lang, text: string) {
  await page.goto(L[lang].path);
  await expect(box(page, lang)).toHaveAttribute("data-hydrated", ""); // typing before the page has hydrated is lost on slower engines
  await box(page, lang).fill(text);
}

for (const lang of ["en", "pt"] as const) {
  const T = L[lang];

  test.describe(`${lang}: several links from the home page`, () => {
    test("the box and its one-line-per-link instruction are in the first screen, no clicks needed", async ({ page }) => {
      await page.goto(T.path);
      await expect(page.getByText(T.hint)).toBeVisible();
      const b = await box(page, lang).boundingBox();
      expect(b!.y + b!.height).toBeLessThan(page.viewportSize()!.height);
      await expect(readButton(page, lang)).toBeInViewport();
      await expect(page.getByRole("textbox", { name: T.box })).toHaveAttribute("placeholder", /example\.com\/article-1/);
    });

    test("1. one link keeps the old behaviour: Enter reads it and its page opens", async ({ page }) => {
      const seen = await watchImports(page);
      await fill(page, lang, priv("solo"));
      await box(page, lang).press("Enter");
      await expect(page.locator("[data-link-page]")).toBeVisible();
      expect(seen.urls).toEqual([priv("solo")]);
    });

    test("2. several links are read one at a time, in the order written, and stay on the page with their results", async ({ page }) => {
      const seen = await watchImports(page);
      const names = ["alpha", "bravo", "charlie", "delta"];
      await fill(page, lang, names.map(priv).join("\n"));
      await readButton(page, lang).click();
      await expect(results(page).getByText(T.finished)).toBeVisible();
      expect(seen.urls).toEqual(names.map(priv));
      expect(seen.peak).toBe(1);
      await expect(count(page, "total")).toHaveText("4");
      await expect(count(page, "saved")).toHaveText("4");
      await expect(count(page, "failed")).toHaveText("0");
      const rows = results(page).locator("[data-row]");
      await expect(rows).toHaveCount(4);
      for (const [i, n] of names.entries()) await expect(rows.nth(i)).toContainText(n);
      expect(new URL(page.url()).pathname).toBe(T.path);
      await expect(box(page, lang)).toHaveValue(""); // ready for the next list
    });

    test("3 and 4. blank lines, spaces, tabs and Windows line breaks are ignored; each link is trimmed", async ({ page }) => {
      const seen = await watchImports(page);
      await fill(page, lang, `\n   ${priv("one")}   \r\n\r\n\t${priv("two")}\t\n\n\n${priv("three")}\n  \n`);
      await expect(page.getByText(/3 links? (ready|prontos?)/)).toBeVisible();
      await readButton(page, lang).click();
      await expect(results(page).getByText(T.finished)).toBeVisible();
      expect(seen.urls).toEqual([priv("one"), priv("two"), priv("three")]);
    });

    test("5. a line that is not a web address is reported and skipped; the valid links are still read", async ({ page }) => {
      const seen = await watchImports(page);
      await fill(page, lang, `${priv("good-a")}\nthis is not a link\nftp://example.com/file\nmailto:me@example.com\n${priv("good-b")}`);
      await expect(page.getByText(T.skipped)).toBeVisible();
      await readButton(page, lang).click();
      await expect(results(page).getByText(T.finished)).toBeVisible();
      expect(seen.urls).toEqual([priv("good-a"), priv("good-b")]);
      await expect(count(page, "saved")).toHaveText("2");
      await expect(count(page, "skipped")).toHaveText("3");
      await expect(results(page).locator('[data-row="skipped"]')).toHaveCount(3);
    });

    test("6. the same link twice in one list (even written differently) is read once", async ({ page }) => {
      const seen = await watchImports(page);
      const host = "http://localhost/batch";
      await fill(page, lang, `${host}/same\nhttp://www.localhost/batch/same/\n${host}/same?utm_source=mail\n${host}/other`);
      await expect(page.getByText(T.repeated)).toBeVisible();
      await readButton(page, lang).click();
      await expect(results(page).getByText(T.finished)).toBeVisible();
      expect(seen.urls).toHaveLength(2);
      await expect(count(page, "total")).toHaveText("2");
    });

    test("7. a link already in the library is reported as such and is not sent again", async ({ page }) => {
      const url = "https://fixtures.example/article-one";
      const seen = await watchImports(page, async (u, route) => {
        if (u !== url) return false;
        await route.fulfill({ json: fixture(url, 1) });
        return true;
      });
      await fill(page, lang, url);
      await box(page, lang).press("Enter"); // a single link: opens the reader and keeps the text in the library
      await expect(page).toHaveURL(/\/read\/fx-1/);
      await page.goto(T.path);
      await box(page, lang).fill(`${url}\n${priv("fresh")}`);
      await readButton(page, lang).click();
      await expect(results(page).getByText(T.finished)).toBeVisible();
      expect(seen.urls).toEqual([url, priv("fresh")]); // the second run sent only the new link
      await expect(count(page, "existing")).toHaveText("1");
      await expect(count(page, "saved")).toHaveText("1");
      await expect(results(page).locator('[data-row="duplicate"]')).toContainText(T.already);
    });

    test("8 and 9. a failed link does not undo the others, and Retry sends only the failed one", async ({ page }) => {
      let failing = true;
      const seen = await watchImports(page, async (u, route) => {
        if (!u.endsWith("/bad") || !failing) return false;
        await route.fulfill({ status: 500, json: { error: "Could not save that link." } });
        return true;
      });
      await fill(page, lang, [priv("ok-1"), priv("bad"), priv("ok-2")].join("\n"));
      await readButton(page, lang).click();
      await expect(results(page).getByText(T.finished)).toBeVisible();
      await expect(count(page, "saved")).toHaveText("2");
      await expect(count(page, "failed")).toHaveText("1");
      await expect(results(page).locator('[data-row="failed"]')).toContainText(lang === "en" ? "Could not save that link" : "Não foi possível salvar esse link");
      expect(seen.urls).toEqual([priv("ok-1"), priv("bad"), priv("ok-2")]); // the third was still tried after the failure

      failing = false;
      seen.urls.length = 0;
      await results(page).getByRole("button", { name: T.retry }).click();
      await expect(count(page, "failed")).toHaveText("0");
      await expect(count(page, "saved")).toHaveText("3");
      expect(seen.urls).toEqual([priv("bad")]); // the saved ones were not sent a second time
      await expect(results(page).getByRole("button", { name: T.retry })).toHaveCount(0);
    });

    test("10. the reader's session is settled once before the first link, and the saved links are still there after a reload", async ({ page, context }) => {
      const events: string[] = [];
      page.on("request", (r) => {
        const u = new URL(r.url());
        if (r.method() === "POST" && u.pathname === "/api/reader") events.push("reader");
        if (r.method() === "POST" && u.pathname === "/api/import") events.push("import");
      });
      await page.goto(T.path); // a visitor with no cookie yet
      const reader = async () => (await context.cookies()).filter((c) => c.name === "gloss_reader");
      expect(await reader()).toHaveLength(0);
      await expect(box(page, lang)).toHaveAttribute("data-hydrated", "");
      await box(page, lang).fill([priv("keep-1"), priv("keep-2"), priv("keep-3")].join("\n"));
      await readButton(page, lang).click();
      await expect(results(page).getByText(T.finished)).toBeVisible();
      expect(events.filter((e) => e === "reader")).toHaveLength(1);
      expect(await reader()).toHaveLength(1); // one reader for the whole list, not one per link
      expect(events.indexOf("reader")).toBeLessThan(events.indexOf("import"));
      expect(events.filter((e) => e === "import")).toHaveLength(3);
      await page.goto(T.library);
      await expect(page.locator("button.bk")).toHaveCount(3 + 3); // the three samples and the three links, kept by the server for this reader
      await page.reload();
      await expect(page.locator("button.bk")).toHaveCount(3 + 3);
    });

    test("14. pressing the button twice, or the shortcut twice, sends each link once", async ({ page }) => {
      const seen = await watchImports(page);
      await fill(page, lang, [priv("dbl-1"), priv("dbl-2"), priv("dbl-3")].join("\n"));
      const b = readButton(page, lang);
      await b.dblclick();
      await box(page, lang).press("Control+Enter").catch(() => undefined); // the box is locked while reading: nothing more can be sent
      await expect(results(page).getByText(T.finished)).toBeVisible();
      expect(seen.urls).toEqual([priv("dbl-1"), priv("dbl-2"), priv("dbl-3")]);
      await expect(count(page, "total")).toHaveText("3");
    });

    test("a list pasted anywhere on the page (not in the box) is read as links, not saved as one text", async ({ page, browserName }) => {
      test.skip(browserName === "firefox", "Firefox does not let a script build a paste event that carries clipboard data; the handler is the same code on every engine");
      const seen = await watchImports(page);
      await page.goto(T.path);
      await expect(box(page, lang)).toHaveAttribute("data-hydrated", "");
      await page.evaluate((text) => {
        const dt = new DataTransfer();
        dt.setData("text/plain", text);
        document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      }, [priv("paste-1"), priv("paste-2")].join("\n"));
      await expect(results(page).getByText(T.finished)).toBeVisible();
      expect(seen.urls).toEqual([priv("paste-1"), priv("paste-2")]); // read as two links, never saved as one text
    });

    test("13. no accessibility violations: ready hints, running list and finished list", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await fill(page, lang, `${priv("ax-1")}\nnot a link\n${priv("ax-1")}\n${priv("ax-2")}`);
      await expect(page.getByText(T.skipped)).toBeVisible();
      const scan = async () => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 140)}`);
      expect(await scan()).toEqual([]);
      await readButton(page, lang).click();
      await expect(results(page).getByText(T.finished)).toBeVisible();
      await settleAnimations(page);
      expect(await scan()).toEqual([]);
      await expect(results(page).getByRole("link", { name: lang === "en" ? "Open your library" : "Abrir a sua biblioteca" })).toBeVisible();
    });
  });
}

test.describe("12. a phone", () => {
  for (const lang of ["en", "pt"] as const) {
    test(`${lang}: the box is in the first screen, nothing scrolls sideways, and the results fit`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(L[lang].path);
      const b = await box(page, lang).boundingBox();
      expect(b!.y + b!.height).toBeLessThan(844);
      await expect(page.getByText(L[lang].hint)).toBeInViewport();
      await expect(box(page, lang)).toHaveAttribute("data-hydrated", "");
      await box(page, lang).fill([priv("ph-1"), "nope", priv("ph-2")].join("\n"));
      await readButton(page, lang).click();
      await expect(results(page).getByText(L[lang].finished)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const r = await results(page).boundingBox();
      expect(r!.x).toBeGreaterThanOrEqual(0);
      expect(r!.x + r!.width).toBeLessThanOrEqual(390.5);
    });
  }
});

test("more links than one go can read: the first ones are read and the rest is said to be left out", async ({ page }) => {
  let seenCount = 100;
  const seen = await watchImports(page, async (u, route) => {
    await route.fulfill({ json: fixture(u, seenCount++) });
    return true;
  });
  await fill(page, "en", Array.from({ length: 53 }, (_, i) => `https://fixtures.example/many-${i}`).join("\n"));
  await expect(page.getByText(/3 more links are over the limit of 50/)).toBeVisible();
  await readButton(page, "en").click();
  await expect(results(page).getByText(L.en.finished)).toBeVisible({ timeout: 40_000 });
  expect(seen.urls).toHaveLength(50);
});

test("a limit reached on the server stops the list, marks the rest as failed, and Retry resumes", async ({ page }) => {
  let limited = true;
  const seen = await watchImports(page, async (u, route) => {
    if (limited && u.endsWith("/third")) {
      await route.fulfill({ status: 429, json: { error: "That is more than 60 imports in 10 minutes. Try again in about 5 minutes.", code: "rate-limited" } });
      return true;
    }
    return false;
  });
  await fill(page, "en", ["first", "second", "third", "fourth", "fifth"].map(priv).join("\n"));
  await readButton(page, "en").click();
  await expect(results(page).getByText(L.en.finished)).toBeVisible();
  expect(seen.urls).toHaveLength(3); // the fourth and fifth were never tried
  await expect(count(page, "saved")).toHaveText("2");
  await expect(count(page, "failed")).toHaveText("3");
  limited = false;
  await results(page).getByRole("button", { name: L.en.retry }).click();
  await expect(count(page, "saved")).toHaveText("5");
});
