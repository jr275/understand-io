import type { Metadata } from "next";
import { LEGAL_DOCS, type LegalDoc, type LegalLang } from "@/lib/legal/docs";
import { alternatesFor } from "./site";

/** Title, canonical address and `hreflang` for a legal text: it exists in English (`/privacy`) and Portuguese (`/privacy?lang=pt`), and each says so. */
export function legalMetadata(doc: LegalDoc, lang: LegalLang): Metadata {
  const route = LEGAL_DOCS[doc].route;
  const pt = `${route}?lang=pt`;
  return { title: LEGAL_DOCS[doc].title[lang], alternates: alternatesFor(lang === "pt" ? pt : route, { en: route, "pt-BR": pt }) };
}
