import { describe, expect, it } from "vitest";

import { formatCentsPlain, fromCents, toCents } from "@/lib/money";

describe("money", () => {
  it("converts major units to integer cents", () => {
    expect(toCents(3400.75)).toBe(340075);
    expect(toCents(48250)).toBe(4825000);
    expect(toCents(-250.5)).toBe(-25050);
    expect(toCents(0)).toBe(0);
  });

  it("avoids floating-point drift that plagues decimal arithmetic", () => {
    // The classic case: 0.1 + 0.2 !== 0.3 in float.
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(toCents(0.1) + toCents(0.2)).toBe(toCents(0.3));

    // Summing in cents stays exact where summing floats does not.
    const floatSum = 0.1 + 0.2 + 0.3; // 0.6000000000000001
    expect(floatSum).not.toBe(0.6);
    const centsSum = toCents(0.1) + toCents(0.2) + toCents(0.3);
    expect(centsSum).toBe(60);
    expect(fromCents(centsSum)).toBe(0.6);
  });

  it("rounds half-cent representations correctly", () => {
    // 3400.745 * 100 is 340074.49999999994 in float; must round to 340075.
    expect(toCents(3400.745)).toBe(340075);
  });

  it("round-trips through fromCents", () => {
    for (const v of [0, 1, 3400.75, 120000, -9600.5]) {
      expect(fromCents(toCents(v))).toBeCloseTo(v, 10);
    }
  });

  it("formats cents as a grouped decimal string", () => {
    expect(formatCentsPlain(4825000)).toBe("48,250.00");
    expect(formatCentsPlain(-100000)).toBe("-1,000.00");
    expect(formatCentsPlain(5)).toBe("0.05");
  });
});
