import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the heavy OCI SDK out of the bundle; load it at runtime on the server.
  serverExternalPackages: ["oci-common", "oci-objectstorage"],
};

export default nextConfig;
