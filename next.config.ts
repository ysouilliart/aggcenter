import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the Postgres driver out of the bundle; load it at runtime on the server.
  serverExternalPackages: ["pg", "pdfjs-dist"],
  // Next 16 treats 127.0.0.1 as a distinct origin from localhost. Without this,
  // the dev HMR/debug-channel websocket is blocked, React never hydrates, and
  // client hooks like useFetch never run (pages stay on the SSR spinner).
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
