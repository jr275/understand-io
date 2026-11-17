import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/chrome/Topbar";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { LEARN_PAGES, learnPage, learnVisible } from "@/lib/seo/learn";
import { NOINDEX, SITE_NAME, absoluteUrl, alternatesFor, jsonLd, socialFor } from "@/lib/seo/site";

// Whether a draft may be shown depends on the operator's switch, read at request time (as for the legal pages).
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return LEARN_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = learnPage((await params).slug);
  if (!p || !learnVisible(p)) return { title: SITE_NAME, robots: NOINDEX };
  const path = `/learn/${p.slug}`;
  return {
    title: { absolute: p.title },
    description: p.description,
    alternates: alternatesFor(path),
    // A draft that is being previewed must still never be indexed.
    robots: p.status === "published" ? undefined : NOINDEX,
    ...socialFor({ title: p.title, description: p.description, path, type: "article" }),
  };
}

export default async function LearnPage({ params }: Props) {
  const p = learnPage((await params).slug);
  if (!p || !learnVisible(p)) notFound();
  const related = p.related.map((s) => learnPage(s)).filter((r): r is NonNullable<typeof r> => !!r && learnVisible(r));
  const ld = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: p.title,
    description: p.description,
    inLanguage: "en",
    url: absoluteUrl(`/learn/${p.slug}`),
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: absoluteUrl("/") },
  };
  return (
    <div className="relative z-[1] flex min-h-dvh flex-col">
      <Topbar variant="landing" />
      <main className="mx-auto w-full max-w-[720px] flex-1 px-6 pb-24 pt-10 sm:px-8">
        <article lang="en">
          <h1 className="font-serif text-[clamp(2rem,5vw,3.1rem)] leading-[1.05] tracking-[-0.02em] text-ink">{p.h1}</h1>
          <p className="mt-6 font-serif text-[1.18rem] leading-[1.6] text-ink-2">{p.intro}</p>
          {p.sections.map((s) => (
            <section key={s.heading} className="mt-12">
              <h2 className="font-serif text-[1.55rem] leading-tight tracking-[-0.01em] text-ink">{s.heading}</h2>
              {s.paragraphs.map((t) => (
                <p key={t} className="mt-4 text-[1.04rem] leading-[1.7] text-ink-2">
                  {t}
                </p>
              ))}
              {s.points ? (
                <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[1.02rem] leading-[1.6] text-ink-2">
                  {s.points.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
          <aside aria-labelledby="demo-heading" className="mt-14 rounded-[18px] border border-rule bg-sunk px-6 py-6">
            <h2 id="demo-heading" className="font-serif text-[1.4rem] text-ink">
              {p.demo.heading}
            </h2>
            <p className="mt-2 text-[1.02rem] leading-[1.65] text-ink-2">{p.demo.body}</p>
            <Link href={p.demo.href} className="mt-5 inline-flex h-11 items-center rounded-full bg-ink px-6 text-[14.5px] font-medium text-bg" data-testid="learn-demo">
              {p.demo.cta}
            </Link>
          </aside>
          {related.length ? (
            <nav aria-label="Keep reading" className="mt-12 border-t border-rule pt-5 text-[14px] text-ink-3">
              <ul className="flex flex-wrap gap-x-5 gap-y-2">
                {related.map((r) => (
                  <li key={r.slug}>
                    <Link href={`/learn/${r.slug}`} className="underline underline-offset-2">
                      {r.h1}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </article>
      </main>
      <LegalLinks />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(ld) }} />
    </div>
  );
}
