import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages のプロジェクトサイト（https://maji-ky.github.io/lapse_rate_checker/）で配信するため
  base: "/lapse_rate_checker/",
  build: {
    target: "es2024",
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true, // 移植前でテストが無い間も CI を通す
  },
});
