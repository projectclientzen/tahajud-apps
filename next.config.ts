import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Next.js dev badge sits bottom-left, on top of the demo tools button. Hide it.
  devIndicators: false,
  async headers() {
    // The reset link from CS carries a one-time token in the fragment. Nothing on this page may leak it onward.
    return [{ source: "/reset", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] }];
  },
};

export default nextConfig;
