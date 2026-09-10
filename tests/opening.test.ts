import { describe, expect, it } from "vitest";

import {
  closingFromRunningBalances,
  compareChronological,
  openingFromRunningBalances,
} from "@/lib/cash/opening";

describe("openingFromRunningBalances", () => {
  it("returns undefined when no line has a running balance", () => {
    expect(
      openingFromRunningBalances([
        { date: "2026-08-01", amount: 100 },
        { date: "2026-08-02", amount: -40 },
      ]),
    ).toBeUndefined();
  });

  it("uses oldest chronological line: balanceAfter − amount", () => {
    expect(
      openingFromRunningBalances([
        { date: "2026-08-31", amount: 10_000, balanceAfter: 100_000, lineNumber: 1 },
        { date: "2026-08-01", amount: -2_500, balanceAfter: 77_500, lineNumber: 4 },
      ]),
    ).toBe(80_000);
  });

  it("treats a larger line number as older on the same date (newest-first listing)", () => {
    const lines = [
      { date: "2026-08-28", amount: 10_000, balanceAfter: 100_000, lineNumber: 1 },
      { date: "2026-08-28", amount: -2_500, balanceAfter: 77_500, lineNumber: 4 },
    ];
    const sorted = [...lines].sort(compareChronological);
    expect(sorted[0].lineNumber).toBe(4);
    expect(openingFromRunningBalances(lines)).toBe(80_000);
    expect(closingFromRunningBalances(lines)).toBe(100_000);
  });
});
