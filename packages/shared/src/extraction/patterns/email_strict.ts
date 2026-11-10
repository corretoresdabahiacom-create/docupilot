/** Pattern email_strict — docs/heuristics.md §2.1. */
import type { ExtractedField } from '../types';
import { field } from '../util';

export const PATTERN_ID = 'email_strict' as const;
export const FIELD_TYPE = 'email' as const;

const REGEX =
  /(?<![A-Za-z0-9._%+\-@])[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}\b/g;

export function extractEmail(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const raw = m[0];
    const local = raw.slice(0, raw.indexOf('@'));
    if (local.startsWith('.') || local.endsWith('.') || local.includes('..') || raw.includes('..'))
      continue;
    const start = m.index ?? 0;
    out.push(
      field({
        documentId,
        pageNumber,
        start,
        end: start + raw.length,
        raw,
        normalized: raw.toLowerCase(),
        fieldType: FIELD_TYPE,
        patternId: PATTERN_ID,
        confidence: 0.9,
        sourceKind: 'deterministic',
      }),
    );
  }
  return out;
}
