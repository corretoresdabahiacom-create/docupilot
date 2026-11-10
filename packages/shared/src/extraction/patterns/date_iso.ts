/** Pattern date_iso — docs/heuristics.md §3.4. */
import type { ExtractedField } from '../types';
import { field, isValidCalendarDate, labelBefore } from '../util';

export const PATTERN_ID = 'date_iso' as const;
export const FIELD_TYPE = 'date' as const;

const REGEX = /(?<![\d\-\/.])(\d{4})-(\d{2})-(\d{2})(?![\d]|-\d)/g;

export function extractDateISO(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    if (!isValidCalendarDate(Number(m[1]), Number(m[2]), Number(m[3]))) continue;
    const start = m.index ?? 0;
    out.push(
      field(
        {
          documentId,
          pageNumber,
          start,
          end: start + m[0].length,
          raw: m[0],
          normalized: m[0],
          fieldType: FIELD_TYPE,
          patternId: PATTERN_ID,
          confidence: 1.0,
          sourceKind: 'deterministic',
        },
        labelBefore(text, start),
      ),
    );
  }
  return out;
}
