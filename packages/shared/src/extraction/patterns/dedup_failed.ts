/** Pattern dedup_failed — docs/heuristics.md §7.3. Sem texto, só dedup_exact vale. */
export const PATTERN_ID = 'dedup_failed' as const;

export function canCompareSimilarity(doc: { status: string; simhash: string | null }): boolean {
  return doc.status === 'extracted' && doc.simhash !== null && /^[0-9a-f]{16}$/.test(doc.simhash);
}
