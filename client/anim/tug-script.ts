/** The tug-rope replay's script, plain TypeScript so the QA trace can run it too. */

/** Taps a second for each side over the match: even, Blue surges, Red claws back, Blue drags it over. */
export function tugRate(side: 0 | 1, ms: number): number {
  if (ms < 5000) return side ? 4 : 4.4
  if (ms < 9000) return side ? 9 : 3
  if (ms < 13000) return side ? 2 : 9
  return side ? 10 : 1.5
}
