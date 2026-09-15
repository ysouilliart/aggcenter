export type SortDir = "asc" | "desc";

export function compareSortValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null || a === "") return 1;
  if (b == null || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

export function sortRows<T>(
  rows: T[],
  key: string,
  dir: SortDir,
  getValue: (row: T, key: string) => unknown,
): T[] {
  if (!key) return rows;
  const copy = [...rows];
  copy.sort((left, right) => {
    const cmp = compareSortValues(getValue(left, key), getValue(right, key));
    return dir === "asc" ? cmp : -cmp;
  });
  return copy;
}
