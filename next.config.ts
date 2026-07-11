import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/templates/[dataType]": ["./server-assets/templates/v2/*.xlsx"],
  },
};

export default nextConfig;
