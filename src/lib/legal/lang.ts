import { getLocale } from "@/i18n/server";
import { asLang, type LegalLang } from "./docs";

/** The language of a legal text: an explicit `?lang=` (old links keep working), otherwise the language of the address the reader is on. */
export async function legalLang(searchParams: Promise<{ lang?: string }>): Promise<LegalLang> {
  const explicit = (await searchParams).lang;
  if (explicit) return asLang(explicit);
  return (await getLocale()) === "pt-BR" ? "pt" : "en";
}
