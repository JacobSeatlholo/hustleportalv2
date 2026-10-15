import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Legacy PWA installs (Task 13 era) carry a manifest whose start_url/shortcuts
  // pointed at /dashboard, /leads, /invoices — routes that never existed in this
  // single-page app. Redirect them so home-screen icons installed before Task 23
  // self-heal instead of showing a Vercel 404.
  async redirects() {
    return [
      { source: "/dashboard", destination: "/?source=pwa", permanent: true },
      { source: "/leads", destination: "/?view=leads", permanent: true },
      { source: "/invoices", destination: "/?view=invoices", permanent: true },
    ];
  },
  // Security headers on every response. CSP is tuned for Next.js reality:
  // 'unsafe-inline' scripts/styles are required by the framework's bootstrap,
  // but the policy still blocks external script origins, framing, object
  // embeds and form hijacking — the classes that matter for this app.
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https: wss:",
      "media-src 'self' blob: https:",
      "frame-src 'self' https://meet.jit.si https://*.jitsi.net https://online.yoco.com",
      "form-action 'self' https://online.yoco.com",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; ");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
