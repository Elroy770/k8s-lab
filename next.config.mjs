/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  serverExternalPackages: ["yaml"],
};

export default nextConfig;
