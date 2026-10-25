import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  skipMiddlewareUrlNormalize: true,
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
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
