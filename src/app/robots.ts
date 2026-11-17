import type { MetadataRoute } from "next";
import { absoluteUrl, siteOrigin } from "@/lib/seo/site";

/**
 * What crawlers may read. The API and the reader's own library are not for them; which individual texts may be indexed is decided per page
 * (a private text says `noindex` itself, the bundled samples do not), so `/read/` is not blocked here: a blocked page cannot tell a crawler
 * it is `noindex`. The sitemap is named only once the public address is known.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/library"] }],
    ...(origin ? { sitemap: absoluteUrl("/sitemap.xml", origin), host: origin.origin } : {}),
  };
}
