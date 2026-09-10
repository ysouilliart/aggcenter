import { describe, expect, it } from "vitest";

import { getStatementDetail } from "@/lib/service";

describe("getStatementDetail", () => {
  it("returns a bundled sample statement with transactions and no parse job", async () => {
    const detail = await getStatementDetail("STMT-USD-2026-08");
    expect(detail).toBeTruthy();
    expect(detail?.statement.source).toBe("sample");
    expect(detail?.statement.fileName).toMatch(/operating-usd/);
    expect(detail?.transactions.length).toBeGreaterThan(0);
    expect(detail?.transactions.every((t) => t.statementId === "STMT-USD-2026-08")).toBe(
      true,
    );
    expect(detail?.job).toBeNull();
    expect(detail?.account?.id).toBe("ACC-1001");
  });

  it("returns null for an unknown id", async () => {
    expect(await getStatementDetail("does-not-exist")).toBeNull();
    expect(await getStatementDetail("")).toBeNull();
  });
});
