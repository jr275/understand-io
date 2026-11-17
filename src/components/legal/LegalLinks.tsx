import Link from "next/link";
import { localePath } from "@/i18n/config";
import { getLocale } from "@/i18n/server";
import { translate } from "@/i18n/translate";
import { legalLinks } from "@/lib/legal/docs";

/** "Terms · Privacy", drawn only when both texts may be shown (see `lib/legal/docs.ts`). Until then it renders nothing at all. Words and addresses follow the page's language. */
export async function LegalLinks({ className = "" }: { className?: string }) {
  const links = legalLinks();
  if (!links.length) return null;
  const locale = await getLocale();
  return (
    <nav aria-label={translate(locale, "legal.nav")} className={`flex justify-center gap-4 px-6 py-5 text-[12.5px] text-ink-3 ${className}`}>
      {links.map((l) => (
        <Link key={l.href} href={localePath(l.href, locale)} className="underline underline-offset-2 hover:text-ink">
          {translate(locale, l.href === "/privacy" ? "legal.privacy" : "legal.terms")}
        </Link>
      ))}
    </nav>
  );
}
