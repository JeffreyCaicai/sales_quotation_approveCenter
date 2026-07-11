import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  outputFileTracingIncludes: {
    "/api/templates/[dataType]": ["./server-assets/templates/v2/*.xlsx"],
  },
  turbopack: { root: projectRoot },
};

export default nextConfig;
