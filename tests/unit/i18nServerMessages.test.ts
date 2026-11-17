import { afterEach, describe, expect, it, vi } from "vitest";
import { localizeServerMessage, SERVER_MESSAGE_KEYS, catalogSize } from "@/i18n/serverMessages";
import { en } from "@/i18n/messages/en";
import { ptBR } from "@/i18n/messages/pt-BR";

const lookup = (dict: unknown, key: string): string =>
  key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict) as string;

function pageLang(lang: string) {
  vi.stubGlobal("document", { documentElement: { lang } });
}

describe("server message localization", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("has a catalog entry per server message and both dictionaries define every key", () => {
    expect(catalogSize).toBeGreaterThan(100);
    for (const key of SERVER_MESSAGE_KEYS) {
      expect(lookup(en, key), key).toBeTruthy();
      expect(lookup(ptBR, key), key).toBeTruthy();
    }
  });

  it("returns the server message unchanged in English and for unknown messages", () => {
    pageLang("en");
    expect(localizeServerMessage("That does not look like a link.")).toBe("That does not look like a link.");
    pageLang("pt-BR");
    expect(localizeServerMessage("Some message nobody wrote a translation for.")).toBe("Some message nobody wrote a translation for.");
    expect(localizeServerMessage(undefined)).toBe("");
  });

  it("translates every placeholder-free server message into Portuguese", () => {
    pageLang("pt-BR");
    let checked = 0;
    for (const key of SERVER_MESSAGE_KEYS) {
      const source = lookup(en, key);
      if (/\{\w+\}/.test(source)) continue;
      expect(localizeServerMessage(source), key).toBe(lookup(ptBR, key));
      checked++;
    }
    expect(checked).toBeGreaterThan(60);
  });
});
