"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { KeyRound, Library, Plus } from "lucide-react";
import { AddPanel } from "@/components/library/AddPanel";
import { syncRemoteLibrary } from "@/lib/store/library";
import { toast } from "@/lib/store/toast";
import { GlossMark } from "./marks";
import { BRAND } from "@/lib/brand";
import { IconButton } from "@/components/ui/IconButton";
import { Pop } from "@/components/ui/Pop";
import { AppearancePanel } from "./AppearancePanel";
import { KeyPanel } from "./KeyPanel";
import { AccountControl } from "./AccountControl";
import { useI18n } from "@/i18n/client";
import { localePath } from "@/i18n/config";
import { LanguageSwitcher } from "./LanguageSwitcher";

interface Props {
  /** Reader pages render a fixed bar with their own tools. */
  variant?: "landing" | "library" | "reader";
  /** Extra tools placed before the Appearance button (reader). */
  tools?: ReactNode;
  /** Centre slot (reader title). */
  center?: ReactNode;
  /** Tools placed after the key button (reader: Notebook). */
  after?: ReactNode;
  /** 0..1 reading progress drawn as a rubric line along the bottom edge (reader). */
  progress?: number;
  /** Pages that own an Add panel (the library) pass their opener; otherwise the bar shows its own. */
  onAdd?: () => void;
  className?: string;
}

export function Topbar({ variant = "landing", tools, center, after, progress, onAdd, className = "" }: Props) {
  const { t, locale } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState<"aa" | "key" | null>(null);
  const [adding, setAdding] = useState(false);
  const aaRef = useRef<HTMLButtonElement>(null);
  const keyRef = useRef<HTMLButtonElement>(null);
  const reader = variant === "reader";

  const inner = (
    <>
      <div className="flex h-9 items-center gap-3.5 max-[380px]:gap-2.5">
        <Link aria-label={t("topbar.home")} className="rounded-md" href={localePath("/", locale)}>
          <span className="flex h-9 items-center gap-[7px] text-ink">
            <GlossMark />
            <span className={`block translate-y-[2px] font-serif text-[21px] font-[440] leading-[21px] tracking-[-0.018em] [font-variation-settings:'opsz'_36] ${reader ? "max-[480px]:sr-only" : "max-[430px]:sr-only"}`}>{BRAND.name}</span>
          </span>
        </Link>
      </div>
      {reader ? <div className="flex min-w-0 flex-1 justify-center">{center}</div> : null}
      <nav aria-label={reader ? t("topbar.navReader") : t("topbar.navMain")} className="flex items-center gap-1 max-[380px]:gap-0">
        {!reader && (
          <Link
            aria-label={t("common.library")}
            aria-current={pathname === "/library" ? "page" : undefined}
            className="mr-1 inline-flex h-9 items-center gap-2 rounded-full px-3 text-[14px] font-medium text-ink-2 transition-colors hover:bg-sunk hover:text-ink aria-[current=page]:bg-sunk aria-[current=page]:text-ink max-sm:w-9 max-sm:justify-center max-sm:px-0"
            href="/library"
          >
            <Library size={17} aria-hidden="true" />
            <span className="max-sm:hidden">{t("common.library")}</span>
          </Link>
        )}
        {reader ? (
          <IconButton aria-label={t("topbar.add")} data-tip={t("topbar.addTip")} aria-haspopup="dialog" aria-expanded={onAdd ? undefined : adding} onClick={() => (onAdd ? onAdd() : setAdding(true))}>
            <Plus size={17} strokeWidth={2.1} aria-hidden="true" />
          </IconButton>
        ) : (
          // Adding content is the first thing a visitor does here, so it has a word, not only an icon (the word drops out on a phone).
          <button
            type="button"
            aria-label={t("ingest.heading")}
            data-tip={t("topbar.addTip")}
            aria-haspopup="dialog"
            aria-expanded={onAdd ? undefined : adding}
            className="mr-1 inline-flex h-9 items-center gap-1.5 rounded-full border border-rule-strong px-3.5 text-[14px] font-medium text-ink transition-colors hover:bg-sunk max-sm:w-9 max-sm:justify-center max-sm:px-0"
            onClick={() => (onAdd ? onAdd() : setAdding(true))}
          >
            <Plus size={16} strokeWidth={2.1} aria-hidden="true" />
            <span className="max-sm:hidden">{t("ingest.heading")}</span>
          </button>
        )}
        {tools}
        <div className="relative">
          <IconButton ref={aaRef} aria-label={t("topbar.appearance")} data-tip={t("topbar.appearanceTip")} aria-expanded={open === "aa"} aria-haspopup="dialog" onClick={() => setOpen(open === "aa" ? null : "aa")}>
            <span className="block translate-y-[0.5px] font-serif text-[18px] leading-none">Aa</span>
          </IconButton>
          <Pop open={open === "aa"} onClose={() => setOpen(null)} label={t("topbar.appearance")} anchorRef={aaRef}>
            <AppearancePanel reader={reader} />
          </Pop>
        </div>
        <div className="relative">
          <IconButton ref={keyRef} aria-label={t("topbar.key")} data-tip={t("topbar.keyTip")} aria-expanded={open === "key"} aria-haspopup="dialog" onClick={() => setOpen(open === "key" ? null : "key")}>
            <KeyRound size={15} aria-hidden="true" />
          </IconButton>
          <Pop open={open === "key"} onClose={() => setOpen(null)} label={t("topbar.key")} width={320} anchorRef={keyRef}>
            <KeyPanel onDone={() => setOpen(null)} />
          </Pop>
        </div>
        {after}
        <LanguageSwitcher className="ml-1 max-[360px]:ml-0" />
        <AccountControl compact={reader} />
      </nav>
      {adding && !onAdd ? (
        <AddPanel
          onClose={() => setAdding(false)}
          onSaved={(n) => {
            if (n) toast(t("topbar.shelved", { n }), { action: { label: t("common.library"), onClick: () => router.push("/library") } });
            void syncRemoteLibrary();
          }}
        />
      ) : null}
    </>
  );

  if (reader) {
    return (
      <header className={`fixed inset-x-0 top-0 z-40 h-[var(--topbar-h)] border-b border-transparent transition-[transform,background-color,border-color] duration-300 ease-[var(--ease-out)] ${className}`}>
        <div className="mx-auto flex h-full max-w-[1440px] items-center gap-4 max-[360px]:gap-1 px-3 min-[361px]:px-4 sm:px-6">{inner}</div>
        {progress !== undefined ? <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-[2px] origin-left bg-[var(--rubric)] opacity-80 transition-transform duration-150" style={{ transform: `scaleX(${progress})` }} /> : null}
      </header>
    );
  }
  return (
    <header className={`relative z-20 mx-auto flex h-[var(--topbar-h)] w-full max-w-[1400px] shrink-0 items-center justify-between px-5 max-[380px]:px-4 sm:px-8 ${className}`}>
      {inner}
    </header>
  );
}
