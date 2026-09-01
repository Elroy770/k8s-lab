/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["yaml"],
  agentRules: false,
};

export default nextConfig;
