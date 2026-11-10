/** Pattern date_us_numeric — docs/heuristics.md §3.3. MM/DD/AAAA; só em documento em inglês. */
import type { ExtractedField, ExtractOptions } from '../types';
import { field, isValidCalendarDate, labelBefore, pad2 } from '../util';
import { expandYear, NUMERIC_DATE_REGEX } from './date_br_numeric';

export const PATTERN_ID = 'date_us_numeric' as const;
export const FIELD_TYPE = 'date' as const;

export function extractDateUS(
  text: string,
  documentId: string,
  pageNumber: number,
  opts: ExtractOptions = {},
): ExtractedField[] {
  if (opts.language !== 'en') return [];
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(NUMERIC_DATE_REGEX)) {
    if (m[2] !== '/') continue;
    const month = Number(m[1]);
    const day = Number(m[3]);
    const year = expandYear(m[4] as string);
    if (month > 12 || day > 12) continue; // dia > 12 não é ambíguo: fica com date_br_numeric
    if (month === day) continue;
    if (!isValidCalendarDate(year, month, day)) continue;
    const start = m.index ?? 0;
    out.push(
      field(
        {
          documentId,
          pageNumber,
          start,
          end: start + m[0].length,
          raw: m[0],
          normalized: `${year}-${pad2(month)}-${pad2(day)}`,
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
