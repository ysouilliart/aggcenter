import path from "path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "lcov"],
      // Gate the pure financial/core logic — the code where correctness matters
      // most and where unit tests are expected.
      include: [
        "src/lib/parse/**",
        "src/lib/recon/**",
        "src/lib/cash/**",
        "src/lib/anomalies/**",
        "src/lib/money.ts",
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
