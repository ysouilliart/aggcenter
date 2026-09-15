"use client";

import { useCallback, useMemo, useState } from "react";

import { sortRows, type SortDir } from "./sort";

export function useSort<T>(
  rows: T[],
  getValue: (row: T, key: string) => unknown,
  initialKey = "",
  initialDir: SortDir = "asc",
): {
  rows: T[];
  sortKey: string;
  sortDir: SortDir;
  toggle: (key: string) => void;
} {
  const [sortKey, setSortKey] = useState(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const sorted = useMemo(
    () => sortRows(rows, sortKey, sortDir, getValue),
    [rows, sortKey, sortDir, getValue],
  );

  const toggle = useCallback(
    (key: string) => {
      if (key === sortKey) {
        setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
        return;
      }
      setSortKey(key);
      setSortDir("asc");
    },
    [sortKey],
  );

  return { rows: sorted, sortKey, sortDir, toggle };
}
