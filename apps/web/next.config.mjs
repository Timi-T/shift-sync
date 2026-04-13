const nextConfig = {
  // Transpile the shared package so Next.js can handle its TypeScript/ESM
  transpilePackages: ["@shift-sync/shared"],

  // Expose only public env vars to the browser bundle
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
    NEXT_PUBLIC_SOCKET_URL: process.env.NEXT_PUBLIC_SOCKET_URL ?? "http://localhost:4000",
  },

  // Strict mode on for double-invoke detection in development
  reactStrictMode: true,
};

export default nextConfig;
