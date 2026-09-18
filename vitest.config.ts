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
        // Vitest 5 / coverage-v8 5 counts more branch points than 3.x
        // (main was ~86.7% on v3; v5 reports ~84.1% on the same suite).
        branches: 84,
        functions: 90,
        lines: 90,
      },
    },
  },
});
