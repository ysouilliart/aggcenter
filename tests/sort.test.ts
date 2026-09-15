import { describe, expect, it } from "vitest";

import { compareSortValues, sortRows } from "@/lib/sort";

describe("sortRows", () => {
  it("sorts numbers and strings ascending or descending", () => {
    const rows = [
      { name: "b", amount: 2 },
      { name: "a", amount: 10 },
      { name: "c", amount: 1 },
    ];
    const byAmount = sortRows(rows, "amount", "asc", (row, key) =>
      key === "amount" ? row.amount : row.name,
    );
    expect(byAmount.map((r) => r.amount)).toEqual([1, 2, 10]);

    const byNameDesc = sortRows(rows, "name", "desc", (row, key) =>
      key === "amount" ? row.amount : row.name,
    );
    expect(byNameDesc.map((r) => r.name)).toEqual(["c", "b", "a"]);
  });

  it("pushes empty values to the end", () => {
    expect(compareSortValues("", "b")).toBe(1);
    expect(compareSortValues(null, 1)).toBe(1);
  });

  it("leaves rows unchanged when no sort key is set", () => {
    const rows = [{ id: 2 }, { id: 1 }];
    expect(sortRows(rows, "", "asc", (row) => row.id)).toEqual(rows);
  });
});
