/** Pattern dedup_exact — docs/heuristics.md §7.1. Igualdade de SHA-256 do arquivo binário. */
export const PATTERN_ID = 'dedup_exact' as const;

export function isExactDuplicate(shaA: string, shaB: string): boolean {
  return /^[a-f0-9]{64}$/.test(shaA) && shaA === shaB;
}
