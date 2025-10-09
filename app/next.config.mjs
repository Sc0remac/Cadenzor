import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },
  webpack: (config) => {
    config.resolve.alias["@kazador/shared"] = path.resolve(
      __dirname,
      "../shared/src"
    );

    return config;
  },
};

export default nextConfig;
