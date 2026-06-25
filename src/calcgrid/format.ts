// Firm workpaper number convention (the universal rule for every figure shown
// on a workpaper): whole dollars (rounded), thousands separators, and negatives
// shown in (parentheses) AND colored red. This module returns the STRING form;
// the red color is applied wherever the value renders via the `num-negative`
// CSS class (use isNegativeNum to decide). Blank/non-numeric pass through.
//
// NOTE: this is for final workpaper figures (grid cells, totals, form sums).
// Free-form scratch sheets keep decimals — they hold intermediate math.

/** Parse a possibly-formatted value to a number, or null if blank/non-numeric. */
export function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const negParen = /^\(.*\)$/.test(s); // "(1,234)" → negative
  const n = Number(s.replace(/[$,()]/g, ""));
  if (!Number.isFinite(n)) return null;
  return negParen ? -Math.abs(n) : n;
}

/**
 * Accounting string: thousands separators, negatives in (parentheses), "" if
 * blank. `decimals` defaults to 0 (whole dollars — workpaper figures); pass 2
 * for the free-form scratch sheets so ratios/rates keep cents.
 */
export function fmtAccounting(v: unknown, decimals = 0): string {
  const n = toNum(v);
  if (n == null) return v == null || v === "" ? "" : String(v);
  const f = 10 ** decimals;
  const r = Math.round(n * f) / f;
  const abs = Math.abs(r).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return r < 0 ? `(${abs})` : abs;
}

/** True when the value rounds (to `decimals` places) to a negative — drives the red color. */
export function isNegativeNum(v: unknown, decimals = 0): boolean {
  const n = toNum(v);
  if (n == null) return false;
  const f = 10 ** decimals;
  return Math.round(n * f) / f < 0;
}
