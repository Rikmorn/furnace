/**
 * Round a number for inspector DISPLAY, stripping IEEE-754 noise and excess
 * precision: `1.2000000000000002 → 1.2`, `10.090214558538591 → 10.0902`. The
 * document keeps full precision — this drives only the shown text AND the blur
 * dirty-check baseline, so a focus+blur with no edit compares rounded-to-rounded
 * and never commits a truncation (the same posture `QuatField` already uses for
 * euler degrees). Non-finite values pass through unchanged.
 */
export function roundForDisplay(n: number, decimals = 4): number {
  if (!Number.isFinite(n)) return n;
  return Number(n.toFixed(decimals));
}
