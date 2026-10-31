import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.CONTRACTOR_NEXT_DIST_DIR || '.next',
  skipMiddlewareUrlNormalize: true,
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: [
    "officeparser",
    "pdf-parse",
    "tesseract.js",
    "@tesseract.js-data/eng",
    "@tesseract.js-data/heb",
  ],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
