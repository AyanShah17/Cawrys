/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.STANDALONE === "1" ? { output: "standalone" } : {}),
};
export default nextConfig;
