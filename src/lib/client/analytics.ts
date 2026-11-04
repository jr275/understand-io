"use client";

import { bucketAge, routePattern } from "@/lib/analytics/buckets";
import type { EventName } from "@/lib/analytics/events";
import { hasAttribution, parseAttribution, type Attribution } from "@/lib/analytics/attribution";

/**
 * The browser's side of product analytics (`docs/product/analytics.md`). `track(event, props)` queues an event and sends it to `POST /api/events`
 * shortly after. The server decides whether anything is kept (`GLOSS_ANALYTICS`: off by default) and the schema in `lib/analytics/events.ts`
 * decides what an event may carry, so a call site cannot add text by mistake: it would be rejected there, and the types below stop it here.
 *
 * Nothing is stored on the device unless the server says it is in `full` mode, and then only the tab's first-touch attribution in
 * `sessionStorage` (gone when the tab closes). A browser that sends Do Not Track or Global Privacy Control never sends anything.
 */

type Props = Record<string, string | number | boolean>;
interface Queued {
  event: EventName;
  props: Props;
  path: string;
}

const ATTR_KEY = "gloss:attr";
const FLAG_KEY = "gloss:analytics";
let queue: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let attribution: Attribution | null = null;

const optedOut = () => typeof navigator !== "undefined" && (navigator.doNotTrack === "1" || (navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl === true);

function stored(): Attribution | null {
  try {
    const raw = sessionStorage.getItem(ATTR_KEY);
    return raw ? (JSON.parse(raw) as Attribution) : null;
  } catch {
    return null;
  }
}

/** The tab's first-touch attribution: what the address and the referrer said when this tab first arrived (kept only once the server is in `full` mode). */
function current(): Attribution | null {
  if (attribution) return attribution;
  const fromTab = stored();
  if (fromTab) return (attribution = fromTab);
  const fresh = parseAttribution(location.search, document.referrer, location.hostname);
  return hasAttribution(fresh) ? (attribution = fresh) : null;
}

function disabled(): boolean {
  if (optedOut()) return true;
  try {
    return sessionStorage.getItem(FLAG_KEY) === "off";
  } catch {
    return false;
  }
}

async function flush() {
  timer = undefined;
  if (!queue.length || disabled()) {
    queue = [];
    return;
  }
  const events = queue.splice(0, 10);
  const attr = events.some((e) => e.event === "landing_viewed") ? current() : null;
  try {
    const res = await fetch("/api/events", { method: "POST", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ events, ...(attr ? { attribution: attr } : {}) }) });
    const mode = res.headers.get("x-gloss-analytics");
    if (mode === "off") sessionStorage.setItem(FLAG_KEY, "off");
    else if (mode === "full" && attr) sessionStorage.setItem(ATTR_KEY, JSON.stringify(attr));
  } catch {
    /* analytics never gets in the way of reading */
  }
  if (queue.length) schedule();
}

function schedule() {
  if (!timer) timer = setTimeout(() => void flush(), 250);
}

export function track(event: EventName, props: Props = {}) {
  if (typeof window === "undefined" || disabled()) return;
  queue.push({ event, props, path: routePattern(location.pathname) ?? "/other" });
  schedule();
}

/** What a text's age was when it was opened, as the bucket the taxonomy allows. */
export const ageBucketOf = (savedAtIso: string | undefined | null): "0d" | "1-6d" | "7-29d" | "30d+" => {
  const t = savedAtIso ? Date.parse(savedAtIso) : NaN;
  return Number.isFinite(t) ? bucketAge(t, Date.now()) : "0d";
};

/** Where the reader came from, from the page that linked here (never stored): the landing page, the library, or elsewhere. */
export function openedVia(): "landing" | "library" | "direct" {
  try {
    const ref = document.referrer ? new URL(document.referrer) : null;
    if (!ref || ref.origin !== location.origin) return "direct";
    return ref.pathname === "/" ? "landing" : ref.pathname.startsWith("/library") ? "library" : "direct";
  } catch {
    return "direct";
  }
}

/** The sign-in address, carrying the tab's first-touch attribution when the server keeps it (so a registration can be credited to a channel). */
export function signInHref(next: string): string {
  const base = `/api/auth/google?next=${encodeURIComponent(next)}`;
  const a = typeof window === "undefined" ? null : stored();
  return a && hasAttribution(a) ? `${base}&attr=${encodeURIComponent(JSON.stringify(a))}` : base;
}
