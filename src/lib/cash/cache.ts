/**
 * In-process snapshot of derived cash views (recon, forecast, position,
 * anomalies). Recomputed on ingest/upload; reused across dashboard pages so
 * switching Reconciliation ↔ Forecast does not rebuild from every bank row.
 */

let snapshot: unknown = null;
let inflight: Promise<unknown> | null = null;
let generation = 0;

export function invalidateCashWorkspace(): void {
  snapshot = null;
  inflight = null;
  generation += 1;
}

export function cashWorkspaceGeneration(): number {
  return generation;
}

export function getCachedCashWorkspace<T>(): T | null {
  return (snapshot as T | null) ?? null;
}

export function setCachedCashWorkspace<T>(value: T): void {
  snapshot = value;
}

export function getInflightCashWorkspace<T>(): Promise<T> | null {
  return (inflight as Promise<T> | null) ?? null;
}

export function setInflightCashWorkspace<T>(value: Promise<T> | null): void {
  inflight = value;
}
