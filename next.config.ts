import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the Postgres driver out of the bundle; load it at runtime on the server.
  serverExternalPackages: ["pg", "pdfjs-dist"],
};

export default nextConfig;
