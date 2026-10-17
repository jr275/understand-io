"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LogIn, LogOut } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { Pop } from "@/components/ui/Pop";
import { resetLocalLibrary } from "@/lib/store/library";

export interface Me {
  configured: boolean;
  account: { name: string | null; email: string | null; picture: string | null } | null;
}

let cache: Promise<Me> | null = null;
/** `/api/auth/me`, fetched once per page load and shared by every top bar. */
export function fetchMe(force = false): Promise<Me> {
  if (!cache || force) {
    cache = fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : { configured: false, account: null }))
      .catch(() => ({ configured: false, account: null }));
  }
  return cache;
}

/**
 * Sign in / signed-in control for the top bar. Google sign-in is env-gated on the server: when it
 * is not configured the button explains what is missing instead of pretending to work.
 */
export function AccountControl({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    void fetchMe().then((m) => alive && setMe(m));
    return () => {
      alive = false;
    };
  }, []);

  if (!me) return <span aria-hidden="true" className={compact ? "hidden" : "inline-block h-9 w-[72px]"} />;

  if (me.account) {
    const a = me.account;
    const initial = (a.name || a.email || "?").trim().charAt(0).toUpperCase();
    return (
      <div className="relative ml-1">
        <IconButton ref={ref} className="!min-w-9 !px-0" aria-label={`Signed in as ${a.name || a.email || "you"}`} data-tip="Your account" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
          {a.picture ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote avatar; next/image would need the Google host allow-listed
            <img src={a.picture} alt="" referrerPolicy="no-referrer" className="size-7 rounded-full object-cover ring-1 ring-rule" />
          ) : (
            <span className="grid size-7 place-items-center rounded-full bg-[var(--rubric)] text-[12.5px] font-semibold text-white">{initial}</span>
          )}
        </IconButton>
        <Pop open={open} onClose={() => setOpen(false)} label="Your account" width={280} anchorRef={ref}>
          <p className="truncate text-[13.5px] font-medium text-ink">{a.name || "Signed in"}</p>
          {a.email ? <p className="mt-0.5 truncate text-[12.5px] text-ink-3">{a.email}</p> : null}
          <p className="mt-2 text-[12px] leading-snug text-ink-4">Your library, highlights and notes follow this account on any browser you sign in to.</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <Link href="/library" className="inline-flex h-8 items-center rounded-full border border-rule px-3 text-[12.5px] font-medium text-ink-2 hover:border-rule-strong hover:text-ink" onClick={() => setOpen(false)}>
              Your library
            </Link>
            <button
              type="button"
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-ink px-3 text-[12.5px] font-medium text-bg disabled:opacity-60"
              onClick={async () => {
                setBusy(true);
                try {
                  await fetch("/api/auth/signout", { method: "POST" });
                } finally {
                  resetLocalLibrary();
                  cache = null;
                  setMe({ configured: true, account: null });
                  setOpen(false);
                  setBusy(false);
                  router.replace("/");
                  router.refresh();
                }
              }}
            >
              <LogOut size={13} aria-hidden="true" /> Sign out
            </button>
          </div>
        </Pop>
      </div>
    );
  }

  if (compact) return null;

  if (me.configured) {
    return (
      <a href={`/api/auth/google?next=${encodeURIComponent(pathname === "/" ? "/library" : pathname)}`} className="ml-1 inline-flex h-9 items-center gap-2 rounded-full bg-ink px-3.5 text-[13.5px] font-medium text-bg transition-[transform,opacity] hover:opacity-90 active:scale-[0.97]">
        <LogIn size={15} aria-hidden="true" /> Sign in
      </a>
    );
  }

  return (
    <div className="relative ml-1">
      <IconButton ref={ref} className="!px-3.5" aria-label="Sign in" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
        <LogIn size={15} aria-hidden="true" /> Sign in
      </IconButton>
      <Pop open={open} onClose={() => setOpen(false)} label="Sign in" width={320} anchorRef={ref}>
        <p className="text-[13.5px] font-medium text-ink">Sign-in is not set up on this server yet</p>
        <p className="mt-1 text-[12.5px] leading-snug text-ink-3">
          Your library is kept for this browser already. Signing in with Google makes it follow you to other devices. To turn it on, the server needs <code className="rounded bg-sunk px-1 text-[11.5px]">GOOGLE_CLIENT_ID</code>, <code className="rounded bg-sunk px-1 text-[11.5px]">GOOGLE_CLIENT_SECRET</code> and a database.
        </p>
      </Pop>
    </div>
  );
}
