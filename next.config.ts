import type { NextConfig } from "next";

/**
 * Security headers on every response. No script-src policy on purpose: the inline theme-boot script and Next's own inline
 * bootstrap would need nonces; this CSP only covers framing, <base> and form targets. HSTS is production-only so that a
 * local http:// server is never pinned to https in the developer's browser.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'none'; form-action 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  serverExternalPackages: ["postgres", "unpdf", "undici"],
  // With a proxy file Next buffers each matched request body up to this size (default 10 MB, then truncates it): keep it above the
  // largest upload the import routes accept (25 MB file).
  experimental: { proxyClientMaxBodySize: "30mb" },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Every API answer depends on the reader's cookie (or is a one-off): none may be stored by a shared cache.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] },
    ];
  },
};

export default nextConfig;
