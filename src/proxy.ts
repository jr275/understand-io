import { NextResponse, type NextRequest } from "next/server";

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

export const config = { matcher: "/api/:path*" };
