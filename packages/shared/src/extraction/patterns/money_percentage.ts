/** Pattern money_percentage — docs/heuristics.md §4.5. */
import type { ExtractedField } from '../types';
import { field, labelBefore } from '../util';

export const PATTERN_ID = 'money_percentage' as const;
export const FIELD_TYPE = 'percentage' as const;

const REGEX = /(?<![\d.,])(\d{1,3})(?:,(\d{1,2}))?\s?%(?![\w])/g;

export function extractPercentage(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const start = m.index ?? 0;
    out.push(
      field(
        {
          documentId,
          pageNumber,
          start,
          end: start + m[0].length,
          raw: m[0],
          normalized: `${Number(m[1])}${m[2] ? `.${m[2]}` : ''}`,
          fieldType: FIELD_TYPE,
          patternId: PATTERN_ID,
          confidence: 0.9,
          sourceKind: 'deterministic',
        },
        labelBefore(text, start),
      ),
    );
  }
  return out;
}
