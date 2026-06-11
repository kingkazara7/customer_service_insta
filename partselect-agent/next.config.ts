import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 原生/可选依赖不打包,运行时按需 require
  serverExternalPackages: [
    "better-sqlite3",
    "@anthropic-ai/claude-agent-sdk",
    "@xenova/transformers",
  ],
};

export default nextConfig;
