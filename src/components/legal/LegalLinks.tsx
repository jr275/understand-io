import Link from "next/link";
import { legalLinks } from "@/lib/legal/docs";

/** "Terms · Privacy", drawn only when both texts may be shown (see `lib/legal/docs.ts`). Until then it renders nothing at all. */
export function LegalLinks({ className = "" }: { className?: string }) {
  const links = legalLinks();
  if (!links.length) return null;
  return (
    <nav aria-label="Legal" className={`flex justify-center gap-4 px-6 py-5 text-[12.5px] text-ink-3 ${className}`}>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="underline underline-offset-2 hover:text-ink">
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
