import { NextResponse, type NextRequest } from "next/server";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_HEADER, PREFIX, PUBLIC_HEADER, localePath, normalizeLocale, splitLocalePath } from "@/i18n/config";

/** Pages search engines index: each exists once per language, at the address of that language. */
export const isPublicPath = (path: string) => path === "/" || path === "/privacy" || path === "/terms" || path.startsWith("/learn") || path.startsWith("/legal");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Hosts a same-origin browser request may name: the one this server was reached on, the forwarded one, and APP_URL's. */
function allowedHosts(req: NextRequest): Set<string> {
  const hosts = new Set<string>();
  const add = (h: string | null | undefined) => h && hosts.add(h.split(",")[0].trim().toLowerCase());
  add(req.headers.get("host"));
  add(req.headers.get("x-forwarded-host"));
  add(req.nextUrl.host);
  try {
    if (process.env.APP_URL) add(new URL(process.env.APP_URL).host);
  } catch {
    /* a malformed APP_URL is reported where it is used */
  }
  return hosts;
}

/**
 * CSRF defence in depth for state-changing API calls (the reader cookie is SameSite=Lax, this does not rely on that alone).
 * Browsers always send Sec-Fetch-Site and, on POST/PUT/PATCH/DELETE, Origin: a request that says it came from another site
 * is refused. Requests with neither header (curl, server-to-server, Playwright's request fixture) are not browser-driven
 * cross-site requests and pass.
 */
export function proxy(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api/") && req.nextUrl.pathname !== "/api") return routePage(req);
  if (SAFE_METHODS.has(req.method)) return NextResponse.next();
  const site = req.headers.get("sec-fetch-site");
  let refuse = !!site && site !== "same-origin" && site !== "none";
  const origin = req.headers.get("origin");
  if (!refuse && origin) {
    try {
      refuse = !allowedHosts(req).has(new URL(origin).host.toLowerCase());
    } catch {
      refuse = true; // "null" and other opaque origins
    }
  }
  if (refuse) return NextResponse.json({ error: "forbidden", message: "Cross-site requests are not accepted." }, { status: 403 });
  return NextResponse.next();
}

/**
 * Language of a page request, decided by its address. `/pt-BR/...` is the same application, rewritten to the bare path with the language in a request
 * header (one deployment, no copy per language); the bare path is English and does not change. A reader who chose Portuguese and arrives at an indexed
 * English address is sent to the Portuguese one (the choice is a cookie, which a search engine never has, so it always sees both). Nothing is decided
 * from Accept-Language for an indexed page: that would show a crawler and a reader different things at one address.
 */
function routePage(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const { locale, path } = splitLocalePath(pathname);
  const prefixed = !!PREFIX[locale] && path !== pathname;
  const isPublic = isPublicPath(path);
  const chosen = normalizeLocale(req.cookies.get(LOCALE_COOKIE)?.value);
  if (!prefixed && isPublic && chosen && chosen !== "en" && SAFE_METHODS.has(req.method) && req.method !== "OPTIONS") {
    const url = req.nextUrl.clone();
    url.pathname = localePath(path, chosen);
    return NextResponse.redirect(url, 307);
  }
  const headers = new Headers(req.headers);
  headers.delete(LOCALE_HEADER); // never trusted from the outside: only this function sets it
  headers.delete(PUBLIC_HEADER);
  headers.set(PUBLIC_HEADER, isPublic ? "1" : "0");
  if (prefixed) {
    headers.set(LOCALE_HEADER, locale);
    const url = req.nextUrl.clone();
    url.pathname = path;
    url.search = search;
    const res = NextResponse.rewrite(url, { request: { headers } });
    // Opening an address in another language is choosing it, as the switcher does: the app's own pages (library, reader) have no language in their address, so
    // without this a reader who arrived at /pt-BR in an English browser would find the library in English one click later.
    // Only a real page load counts: a link the browser merely prefetches (the brand link of a Portuguese page points at /pt-BR) must not change the reader's language.
    const opened = req.headers.get("sec-fetch-dest") === "document" && !req.headers.get("rsc") && !req.headers.get("next-router-prefetch");
    if (opened && req.method === "GET" && req.cookies.get(LOCALE_COOKIE)?.value !== locale) res.cookies.set(LOCALE_COOKIE, locale, { path: "/", maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    return res;
  }
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/api/:path*", "/((?!api/|_next/|.*\\..*).*)"] };
