/**
 * Where a visit came from: the campaign tags on the address (`utm_source`, `utm_medium`, `utm_campaign`), a referral code (`ref`), and the site
 * that linked here. Only short, lower-case, tidy tokens are kept; the referrer is reduced to its host (its path and query can carry anything).
 * No part of this identifies a person.
 */
export interface Attribution {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  /** A referral code of the product's own (never an e-mail address or a user id); `null` when absent or malformed. */
  ref: string | null;
  /** The host of the page that linked here (`news.ycombinator.com`), or null when there was none or it was this site. */
  referrerHost: string | null;
}

const token = (v: string | null | undefined, max = 48): string | null => {
  const t = (v ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  return t && t.length <= max && /^[a-z0-9][a-z0-9_.-]*$/.test(t) ? t : null;
};

/** A referral code is 6 to 24 characters of letters and digits, so an address, a name or a sentence put there is refused. */
const refCode = (v: string | null | undefined): string | null => (v && /^[A-Za-z0-9]{6,24}$/.test(v.trim()) ? v.trim() : null);

/** A name a website can have: labels of letters, digits and hyphens, a dot and a top-level domain. No address literal (an IP names a machine, often a person's), no port, no credentials. */
const SITE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;

export function referrerHostOf(referrer: string | null | undefined, ownHost?: string | null): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host.length > 80 || !SITE_HOST.test(host)) return null;
    if (ownHost && host === ownHost.toLowerCase().replace(/^www\./, "")) return null;
    return host;
  } catch {
    return null;
  }
}

export function parseAttribution(search: string | URLSearchParams, referrer?: string | null, ownHost?: string | null): Attribution {
  const q = typeof search === "string" ? new URLSearchParams(search) : search;
  return {
    source: token(q.get("utm_source")) ?? token(q.get("source")),
    medium: token(q.get("utm_medium")),
    campaign: token(q.get("utm_campaign")),
    ref: refCode(q.get("ref")),
    referrerHost: referrerHostOf(referrer, ownHost),
  };
}

export const hasAttribution = (a: Attribution) => Object.values(a).some(Boolean);

/** The channel a visit is counted under in the growth report: a tagged source wins, then the referring site, otherwise direct. */
export function channelOf(a: Pick<Attribution, "source" | "medium" | "referrerHost" | "ref">): string {
  if (a.ref) return "referral";
  if (a.source) return a.medium ? `${a.source}/${a.medium}` : a.source;
  if (a.referrerHost) {
    if (/(^|\.)(google|bing|duckduckgo|ecosia|brave|yahoo)\./.test(a.referrerHost)) return "organic-search";
    return `site:${a.referrerHost}`;
  }
  return "direct";
}

/** The campaign mediums that are recognised; anything else a link says is recorded as "other". */
export const MEDIUMS = ["email", "newsletter", "social", "cpc", "affiliate", "referral", "organic", "qr", "other"] as const;

const allowed = (list: string | undefined) => new Set((list ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));

/**
 * What the server keeps of attribution a browser sent (untrusted: anyone can write anything in a link). A tag that merely looks tidy can still
 * be a name, a phone number or an e-mail local part, so none is stored as written: the medium must be one of `MEDIUMS`, and the source and the
 * campaign must be ones the operator listed (`GLOSS_ANALYTICS_SOURCES`, `GLOSS_ANALYTICS_CAMPAIGNS`, comma separated); every other value is stored
 * as "other". The referral code is format-checked here and stored only as a keyed hash (see `lib/server/analytics.ts`). The referrer is a site name.
 */
export function cleanAttribution(raw: unknown, env: Record<string, string | undefined> = process.env): Attribution {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
  const pick = (v: string | null, ok: (t: string) => boolean) => {
    const t = token(v);
    return t === null ? null : ok(t) ? t : "other";
  };
  const sources = allowed(env.GLOSS_ANALYTICS_SOURCES);
  const campaigns = allowed(env.GLOSS_ANALYTICS_CAMPAIGNS);
  return {
    source: pick(s("source"), (t) => sources.has(t)),
    medium: pick(s("medium"), (t) => (MEDIUMS as readonly string[]).includes(t)),
    campaign: pick(s("campaign"), (t) => campaigns.has(t)),
    ref: refCode(s("ref")),
    referrerHost: s("referrerHost") ? referrerHostOf(`https://${s("referrerHost")}`) : null,
  };
}
