// Next.js configuration for the Signal web dashboard within the monorepo workspace.
import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@signal/shared"],
};

export default nextConfig;
