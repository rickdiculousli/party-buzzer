export function tugRate(side: 0 | 1, ms: number): number {
  if (ms < 5000) return side ? 6 : 6.4
  if (ms < 9000) return side ? 9 : 5.5
  if (ms < 13000) return side ? 5 : 8.5
  return side ? 9 : 6
}
