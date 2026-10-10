import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  output: 'export',
  images: { unoptimized: true },
  // cacheComponents (PPR) и partialPrefetching несовместимы с output: 'export' —
  // сборка падает с "Invariant: PPR cannot be enabled in export mode".
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
