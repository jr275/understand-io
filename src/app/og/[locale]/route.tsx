import { ogCard } from "@/lib/seo/ogCard";
import { LOCALES, type Locale } from "@/lib/seo/site";

export const dynamicParams = false;
export const generateStaticParams = () => Object.keys(LOCALES).map((locale) => ({ locale }));

/** The social card in one language: `/og/en`, `/og/pt-BR`. Drawn at build time. */
export async function GET(_req: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!(locale in LOCALES)) return new Response("Not found", { status: 404 });
  return ogCard(locale as Locale);
}
