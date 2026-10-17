"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { KeyRound, Library, Plus } from "lucide-react";
import { AddPanel } from "@/components/library/AddPanel";
import { syncRemoteLibrary } from "@/lib/store/library";
import { toast } from "@/lib/store/toast";
import { GlossMark, PartnerMark } from "./marks";
import { IconButton } from "@/components/ui/IconButton";
import { Pop } from "@/components/ui/Pop";
import { AppearancePanel } from "./AppearancePanel";
import { KeyPanel } from "./KeyPanel";
import { AccountControl } from "./AccountControl";

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
        <Link aria-label="Understand.io, back to your library" className="rounded-md" href="/">
          <span className="flex h-9 items-center gap-[7px] text-ink">
            <GlossMark />
            <span className="block translate-y-[2px] font-serif text-[21px] font-[440] leading-[21px] tracking-[-0.018em] [font-variation-settings:'opsz'_36]">Understand.io</span>
          </span>
        </Link>
        <span aria-hidden="true" className="h-[18px] w-px bg-rule-strong" />
        <a
          href="https://www.together.ai"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Together AI"
          data-tip="Models served by Together AI"
          className="flex h-9 shrink-0 items-center rounded-sm text-ink opacity-75 transition-opacity duration-200 hover:opacity-100"
        >
          <PartnerMark />
        </a>
      </div>
      {reader ? <div className="flex min-w-0 flex-1 justify-center">{center}</div> : null}
      <nav aria-label={reader ? "Reader tools" : "Main"} className="flex items-center gap-1 max-[380px]:gap-0">
        {!reader && (
          <Link
            aria-label="Library"
            aria-current={pathname === "/library" ? "page" : undefined}
            className="mr-1 inline-flex h-9 items-center gap-2 rounded-full px-3 text-[14px] font-medium text-ink-2 transition-colors hover:bg-sunk hover:text-ink aria-[current=page]:bg-sunk aria-[current=page]:text-ink max-sm:w-9 max-sm:justify-center max-sm:px-0"
            href="/library"
          >
            <Library size={17} aria-hidden="true" />
            <span className="max-sm:hidden">Library</span>
          </Link>
        )}
        <IconButton aria-label="Add a link, PDF or text" data-tip="Add to your library" aria-haspopup="dialog" aria-expanded={onAdd ? undefined : adding} onClick={() => (onAdd ? onAdd() : setAdding(true))}>
          <Plus size={17} strokeWidth={2.1} aria-hidden="true" />
        </IconButton>
        {tools}
        <div className="relative">
          <IconButton ref={aaRef} aria-label="Appearance and answers" data-tip="Appearance" aria-expanded={open === "aa"} aria-haspopup="dialog" onClick={() => setOpen(open === "aa" ? null : "aa")}>
            <span className="block translate-y-[0.5px] font-serif text-[18px] leading-none">Aa</span>
          </IconButton>
          <Pop open={open === "aa"} onClose={() => setOpen(null)} label="Appearance and answers" anchorRef={aaRef}>
            <AppearancePanel reader={reader} />
          </Pop>
        </div>
        <div className="relative">
          <IconButton ref={keyRef} aria-label="Together API key" data-tip="Add your Together key" aria-expanded={open === "key"} aria-haspopup="dialog" onClick={() => setOpen(open === "key" ? null : "key")}>
            <KeyRound size={15} aria-hidden="true" />
          </IconButton>
          <Pop open={open === "key"} onClose={() => setOpen(null)} label="Together API key" width={320} anchorRef={keyRef}>
            <KeyPanel onDone={() => setOpen(null)} />
          </Pop>
        </div>
        {after}
        <AccountControl compact={reader} />
      </nav>
      {adding && !onAdd ? (
        <AddPanel
          onClose={() => setAdding(false)}
          onSaved={(n) => {
            if (n) toast(`${n} article${n === 1 ? "" : "s"} shelved.`, { action: { label: "Library", onClick: () => router.push("/library") } });
            void syncRemoteLibrary();
          }}
        />
      ) : null}
    </>
  );

  if (reader) {
    return (
      <header className={`fixed inset-x-0 top-0 z-40 h-[var(--topbar-h)] border-b border-transparent transition-[transform,background-color,border-color] duration-300 ease-[var(--ease-out)] ${className}`}>
        <div className="mx-auto flex h-full max-w-[1440px] items-center gap-4 px-4 sm:px-6">{inner}</div>
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
