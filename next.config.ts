import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["@libsql/client"],
  // a stray /Users/jm/package-lock.json otherwise confuses Turbopack's root inference
  turbopack: { root: process.cwd() },
  // dev only: let the remote dev box be opened by LAN IP (Next blocks non-localhost /_next/* and HMR by default)
  allowedDevOrigins: ["192.168.210.200"],
};

export default nextConfig;
