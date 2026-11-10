/** Pattern currency_usd — docs/heuristics.md §4.2. "US$ 1,234.56", "USD 50" ou "$" perto de USD. */
import type { ExtractedField } from '../types';
import { money, parseAmount } from '../money';
import { field, labelBefore } from '../util';

export const PATTERN_ID = 'currency_usd' as const;
export const FIELD_TYPE = 'money' as const;

const REGEX = /(?<![\w])(US\$|USD|\$)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d]|\.\d|,\d)/g;

export function extractCurrencyUSD(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const start = m.index ?? 0;
    // "$" sozinho só vale com USD/dólar por perto (evita confundir com outras moedas)
    if (m[1] === '$') {
      const ctx = text.slice(Math.max(0, start - 40), start + m[0].length + 40);
      if (!/\bUSD\b|d[óo]lar|dollar/i.test(ctx)) continue;
    }
    const amount = parseAmount(`${m[2]}${m[3] ? `.${m[3]}` : ''}`);
    if (!amount) continue;
    out.push(
      field(
        {
          documentId,
          pageNumber,
          start,
          end: start + m[0].length,
          raw: m[0],
          normalized: money(amount, 'USD'),
          fieldType: FIELD_TYPE,
          patternId: PATTERN_ID,
          confidence: m[1] === '$' ? 0.9 : 1.0,
          sourceKind: 'deterministic',
        },
        labelBefore(text, start),
      ),
    );
  }
  return out;
}
