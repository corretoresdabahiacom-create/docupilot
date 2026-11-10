/** Pattern currency_eur — docs/heuristics.md §4.3. "€ 1.234,56", "EUR 50", "50 €". */
import type { ExtractedField } from '../types';
import { money, parseAmount } from '../money';
import { field, labelBefore } from '../util';

export const PATTERN_ID = 'currency_eur' as const;
export const FIELD_TYPE = 'money' as const;

const REGEX =
  /(?<![\w.,])(?:(?:€|EUR)\s?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)|(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s?€)(?![\d]|[.,]\d)/g;

export function extractCurrencyEUR(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const amount = parseAmount((m[1] ?? m[2]) as string);
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
          normalized: money(amount, 'EUR'),
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
