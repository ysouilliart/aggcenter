/**
 * Money handling for aggcenter.
 *
 * All monetary values in the domain are stored and computed as **integer minor
 * units** (cents). Integer arithmetic avoids the floating-point drift that would
 * otherwise corrupt reconciliation and cash-position math (e.g. `0.1 + 0.2`).
 *
 * Convert to/from major units (dollars/euros) only at boundaries:
 *   - `toCents` when ingesting external decimal amounts (CSV, sample JSON, APIs)
 *   - `fromCents` / formatting helpers when presenting values to humans
 */

/** Convert a decimal major-unit amount (e.g. 3400.75) to integer cents (340075). */
export function toCents(major: number): number {
  if (!Number.isFinite(major)) return NaN;
  // Round through a small epsilon to defend against representations like
  // 3400.745 * 100 = 340074.49999999994.
  return Math.round((major + Number.EPSILON * Math.sign(major)) * 100);
}

/** Convert integer cents (340075) back to a major-unit number (3400.75). */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Format integer cents as a plain grouped decimal string, e.g. "3,400.75". */
export function formatCentsPlain(cents: number): string {
  return fromCents(cents).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
