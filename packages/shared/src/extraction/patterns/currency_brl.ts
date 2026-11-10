/** Pattern currency_brl — docs/heuristics.md §4.1. */
import type { ExtractedField } from '../types';
import { money, parseAmount } from '../money';
import { field, labelBefore } from '../util';

export const PATTERN_ID = 'currency_brl' as const;
export const FIELD_TYPE = 'money' as const;

const REGEX = /(?<![\w])R\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{2}))?(?![\d]|,\d|\.\d)/g;

export function extractCurrencyBRL(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const amount = parseAmount(`${m[1]}${m[2] ? `,${m[2]}` : ''}`);
    if (!amount) continue;
    const start = m.index ?? 0;
    out.push(
      field(
        {
          documentId,
          pageNumber,
          start,
          end: start + m[0].length,
          raw: m[0],
          normalized: money(amount, 'BRL'),
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
