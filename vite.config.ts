import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages のプロジェクトサイト（https://maji-ky.github.io/lapse_rate_checker/）で配信するため
  base: "/lapse_rate_checker/",
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
