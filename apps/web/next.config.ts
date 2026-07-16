import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // `@market-track/db` y `@market-track/shared` exportan TypeScript crudo
  // (`main: ./src/index.ts`), no JS compilado: Next debe transpilarlos.
  transpilePackages: ["@market-track/db", "@market-track/shared"],
};

export default nextConfig;
