/** Buckets and route patterns, with no imports: the browser uses these without pulling in the schema library. */

export type AgeBucket = "0d" | "1-6d" | "7-29d" | "30d+";
export type CountBucket = "0" | "1-3" | "4-10" | "11+";

export const bucketAge = (savedAtMs: number, nowMs: number): AgeBucket => {
  const days = Math.max(0, Math.floor((nowMs - savedAtMs) / 86_400_000));
  return days < 1 ? "0d" : days < 7 ? "1-6d" : days < 30 ? "7-29d" : "30d+";
};

export const bucketCount = (n: number): CountBucket => (n <= 0 ? "0" : n <= 3 ? "1-3" : n <= 10 ? "4-10" : "11+");

/** The routes an event may name, with every identifier replaced: `/read/my-private-title` is recorded as `/read/:slug`. */
export function routePattern(path: string | undefined): string | null {
  if (!path) return null;
  const clean = path.split(/[?#]/)[0].slice(0, 200);
  if (!clean.startsWith("/")) return null;
  if (clean === "/") return "/";
  if (/^\/read\/[^/]+\/?$/.test(clean)) return "/read/:slug";
  if (/^\/learn\/[^/]+\/?$/.test(clean)) return "/learn/:page";
  if (/^\/legal\/[^/]+\/?$/.test(clean)) return "/legal/:doc";
  if (["/library", "/privacy", "/terms"].includes(clean.replace(/\/$/, ""))) return clean.replace(/\/$/, "");
  return "/other";
}

