import type { Metadata, Viewport } from "next";
import { Atkinson_Hyperlegible_Next, Literata, Newsreader, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import { BRAND } from "@/lib/brand";
import { ThemeBoot } from "@/components/chrome/ThemeBoot";
import { TipLayer } from "@/components/ui/Tip";
import { GlobalImport } from "@/components/chrome/GlobalImport";
import { ImportQueuePanel } from "@/components/chrome/ImportQueuePanel";
import { I18nProvider } from "@/i18n/client";
import { htmlLang, ogLocale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { translate } from "@/i18n/translate";

const newsreader = Newsreader({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--nf-serif",
  display: "swap",
});
const schibsted = Schibsted_Grotesk({
  subsets: ["latin", "latin-ext"],
  variable: "--nf-sans",
  display: "swap",
});
const literata = Literata({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--nf-book",
  display: "swap",
});
const atkinson = Atkinson_Hyperlegible_Next({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  variable: "--nf-legible",
  display: "swap",
});

/** The public origin, so canonical and social-card addresses follow `APP_URL` when the domain changes (no code change then). Absent in previews and local work. */
const siteOrigin = (() => {
  try {
    return process.env.APP_URL ? new URL(process.env.APP_URL) : undefined;
  } catch {
    return undefined;
  }
})();

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const description = translate(locale, "meta.siteDescription");
  return {
    metadataBase: siteOrigin,
    alternates: siteOrigin ? { canonical: "./" } : undefined,
    title: { default: BRAND.name, template: "%s" },
    description,
    applicationName: BRAND.applicationName,
    openGraph: { title: BRAND.name, description, siteName: BRAND.name, type: "website", locale: ogLocale(locale) },
    twitter: { card: "summary_large_image", title: BRAND.name, description },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BRAND.colors.paper },
    { media: "(prefers-color-scheme: dark)", color: BRAND.colors.paperDark },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html
      lang={htmlLang(locale)}
      suppressHydrationWarning
      className={`${newsreader.variable} ${schibsted.variable} ${literata.variable} ${atkinson.variable}`}
      data-theme="paper"
      data-pen="vermilion"
      data-face="serif"
      data-align="left"
      data-paras="spaced"
    >
      <head>
        <ThemeBoot />
      </head>
      <body>
        <I18nProvider locale={locale}>
          {children}
          <TipLayer />
          <GlobalImport />
          <ImportQueuePanel />
        </I18nProvider>
      </body>
    </html>
  );
}
