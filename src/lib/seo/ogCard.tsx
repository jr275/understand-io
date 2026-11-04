import { ImageResponse } from "next/og";
import { translate } from "@/i18n/translate";
import type { Locale } from "@/lib/seo/site";
import { BRAND } from "@/lib/brand";

export const OG_SIZE = { width: 1200, height: 630 };

/** The social card: the product's name and its one idea, in the colours of the paper theme, in the language of the page it is shown for. No external font or image. */
export function ogCard(locale: Locale) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 96px", background: BRAND.colors.paper, color: BRAND.colors.ink, fontFamily: "Georgia, serif" }}>
        <div style={{ display: "flex", fontSize: 30, letterSpacing: 2, textTransform: "uppercase", color: BRAND.colors.inkFaint, fontFamily: "sans-serif" }}>{BRAND.name}</div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 28, fontSize: locale === "pt-BR" ? 80 : 92, lineHeight: 1.04, letterSpacing: -2 }}>
          <div style={{ display: "flex" }}>
            {t("landing.heroHighlight")}
            <span style={{ padding: "0 14px", background: BRAND.colors.highlight }}>{t("landing.heroMark")}</span>
            {t("landing.heroDot")}
          </div>
          <div style={{ display: "flex" }}>{t("landing.heroAsk")}</div>
        </div>
        <div style={{ display: "flex", marginTop: 40, fontSize: 32, color: BRAND.colors.inkMuted, fontFamily: "sans-serif" }}>{t("meta.ogSub")}</div>
      </div>
    ),
    OG_SIZE,
  );
}
