import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // AGENTS.md ведётся вручную: это контракт стыковки с бэкендом, а не документ Next.js.
  // Оба блока ниже Next.js дописывает при `next dev` и восстанавливает, если их удалить,
  // поэтому генерация выключена. agentRules включён по умолчанию;
  // experimental.agentFeedback вдобавок требует включённой телеметрии, а она здесь запрещена.
  agentRules: false,
  experimental: {
    agentFeedback: false,
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
