import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { BRAND } from "@/lib/brand";
import { SITE_NAME } from "@/lib/seo/site";
import { translate } from "@/i18n/translate";
import { BACKUP_APP, buildBackup, parseBackup } from "@/lib/store/backup";
import { describeFetchStatus } from "@/lib/server/importStatus";
import { systemPrompt } from "@/lib/ai/prompts";

const tracked = (...pathspec: string[]) =>
  execFileSync("git", ["grep", "-I", "-n", ...pathspec], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
const grep = (args: string[]) => {
  try {
    return tracked(...args);
  } catch {
    return []; // git grep exits 1 when nothing matches
  }
};

describe("brand configuration", () => {
  it("names the product Keeple.me and remembers what it was called", () => {
    expect(BRAND.name).toBe("Keeple.me");
    expect(BRAND.previousName).toBe("Understand.io");
    expect(SITE_NAME).toBe(BRAND.name);
  });

  it("does not claim a domain it has not verified, and builds no address from it", () => {
    expect(BRAND.domain.verified).toBe(false);
    // Every canonical, sitemap and OAuth address comes from APP_URL; a literal keeple.me URL in the source would bypass that.
    expect(grep(["-i", "-E", "https?://(www\\.)?keeple\\.me", "--", "src", "scripts", "next.config.ts", "vercel.json"])).toEqual([]);
  });

  it("carries the product's name in both languages' SEO copy", () => {
    for (const locale of ["en", "pt-BR"] as const) {
      expect(BRAND.copy[locale].seoTitle.startsWith(`${BRAND.name}:`)).toBe(true);
      expect(translate(locale, "meta.landingTitle")).toBe(BRAND.copy[locale].seoTitle);
      expect(translate(locale, "meta.siteDescription")).toBe(BRAND.copy[locale].description);
      expect(translate(locale, "meta.landingDescription")).toBe(BRAND.copy[locale].seoDescription);
      expect(translate(locale, "topbar.home")).toContain(BRAND.name);
    }
  });

  it("uses the new short name for the bookmark and keeps the Understand panel's own name", () => {
    expect(translate("en", "add.readIn")).toBe(`Read in ${BRAND.shortName}`);
    expect(translate("pt-BR", "add.readIn")).toBe(`Ler no ${BRAND.shortName}`);
    expect(translate("en", "add.saveTo")).toBe(`Save to ${BRAND.shortName}`);
    expect(translate("pt-BR", "add.saveTo")).toBe(`Salvar no ${BRAND.shortName}`);
    expect(translate("en", "reader.understand")).toBe("Understand"); // a feature, not the product
  });

  it("speaks as the product in the AI prompt and in the import error that points at the bookmark", () => {
    expect(systemPrompt("short", "en")).toContain(`You are ${BRAND.name},`);
    expect(describeFetchStatus(403).error).toContain(`“Read in ${BRAND.shortName}”`);
  });

  it("keeps the old backup marker, so a backup made before the rename still restores and a new one still opens in an older copy", () => {
    expect(BACKUP_APP).toBe(BRAND.legacy.backupApp);
    const written = buildBackup({ docs: {}, progress: {}, annotations: {}, glosses: {} }, new Date("2026-11-03T00:00:00Z"));
    expect(written.app).toBe("understand-io");
    expect(parseBackup(JSON.stringify(written)).ok).toBe(true);
    const refused = parseBackup(JSON.stringify({ hello: 1 }));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toBe(`That file is not a ${BRAND.name} backup.`);
  });

  it("leaves the old name only where it is an identifier, a historical record or a fixture", () => {
    // The old product name, as source text a reader could see. Allowed: this config (which records it), the bundled essays (public-domain text that
    // uses the word "understand"), and nothing else under src/.
    const hits = grep(["-i", "-E", "understand\\.io|understand-io", "--", "src", ":(exclude)src/content"]).filter((l) => !l.startsWith("src/lib/brand.ts:"));
    // The two legacy identifiers that must keep working are named in their own comments.
    expect(hits.filter((l) => !/legacy|Legacy|understand-io"/.test(l))).toEqual([]);
  });
});
