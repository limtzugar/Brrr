import type { NextConfig } from "next";

const BRRR_PORT = 3005;

const nextConfig: NextConfig = {
  output: 'standalone',
  env: {
    PORT: String(BRRR_PORT),
    BASE_URL: `http://localhost:${BRRR_PORT}`,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    '.space-z.ai',
    '.space.chatglm.site',
    '.chatglm.site',
  ],
};

export default nextConfig;
