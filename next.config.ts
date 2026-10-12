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
};

export default nextConfig;
