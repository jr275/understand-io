import type { Metadata } from "next";
import { Topbar } from "@/components/chrome/Topbar";
import { Toasts } from "@/components/chrome/Toasts";
import { ImportBar } from "@/components/landing/ImportBar";
import { SampleRow } from "@/components/landing/SampleRow";
import { Desk } from "@/components/landing/Desk";
import { Notice } from "@/components/chrome/Notice";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { LandingBeacon } from "@/components/chrome/AnalyticsBeacons";
import { SITE_NAME, absoluteUrl, alternatesFor, jsonLd, socialFor } from "@/lib/seo/site";
import { htmlLang, localePath, type Locale } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { translate, translatorFor } from "@/i18n/translate";

/** The landing page exists in both languages, each at its own address: `/` and `/pt-BR`, declared to search engines as each other's alternates. */
const LANDING_LANGUAGES = { en: localePath("/", "en"), "pt-BR": localePath("/", "pt-BR") };

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title = translate(locale, "meta.landingTitle");
  const description = translate(locale, "meta.landingDescription");
  const path = localePath("/", locale);
  return { title: { absolute: title }, description, alternates: alternatesFor(path, LANDING_LANGUAGES), ...socialFor({ title, description, path, locale }) };
}

const applicationLd = (locale: Locale) =>
  jsonLd({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    description: translate(locale, "meta.landingDescription"),
    url: absoluteUrl(localePath("/", locale)),
    applicationCategory: translate(locale, "meta.appCategory"),
    operatingSystem: translate(locale, "meta.os"),
    inLanguage: htmlLang(locale),
  });

export default async function LandingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const locale = await getLocale();
  const t = translatorFor(locale);
  const url = typeof sp.url === "string" ? sp.url : typeof sp.save === "string" ? sp.save : undefined;
  const capture = sp.capture === "read" || sp.capture === "save" ? sp.capture : undefined;
  const signin = typeof sp.signin === "string" ? sp.signin.slice(0, 200) : "";
  return (
    <div className="landing relative z-[1] flex min-h-dvh flex-col transition-[opacity,filter,transform] duration-300 ease-[var(--ease-out)]">
      <Topbar variant="landing" />
      <main className="relative flex flex-1 flex-col pb-[clamp(20px,4vh,44px)]">
        <div className="flex flex-1 flex-col justify-center pb-[clamp(16px,3vh,36px)] pt-[clamp(28px,8vh,96px)]">
          <section className="mx-auto flex w-full max-w-[980px] flex-col items-center px-6 text-center sm:px-10">
            <h1 className="hero-title font-serif text-ink">
              <span className="block">
                {t("landing.heroHighlight")}
                <span className="hero-mark">{t("landing.heroMark")}</span>
                {t("landing.heroDot")}
              </span>
              <span className="block">{t("landing.heroAsk")}</span>
            </h1>
            <ImportBar initialUrl={url} capture={capture} />
            <SampleRow />
          </section>
        </div>
        <Desk />
        <LegalLinks />
      </main>
      <LandingBeacon />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: applicationLd(locale) }} />
      <Toasts bottom={24} />
      {signin ? <Notice text={signin} /> : null}
    </div>
  );
}
