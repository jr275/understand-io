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

export function referrerHostOf(referrer: string | null | undefined, ownHost?: string | null): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host.length > 80) return null;
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

/** Re-validates what a browser sent as attribution (it is untrusted): the same rules as `parseAttribution`, applied to an object. */
export function cleanAttribution(raw: unknown): Attribution {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
  return { source: token(s("source")), medium: token(s("medium")), campaign: token(s("campaign")), ref: refCode(s("ref")), referrerHost: s("referrerHost") ? referrerHostOf(`https://${s("referrerHost")}`) : null };
}
