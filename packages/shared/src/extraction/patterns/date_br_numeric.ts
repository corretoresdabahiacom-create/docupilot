/**
 * Pattern date_br_numeric — docs/heuristics.md §3.1. DD/MM/AAAA (separadores / - .).
 * Em documento em inglês, datas ambíguas pertencem a date_us_numeric; aqui só ficam as que não
 * podem ser MM/DD (dia > 12).
 */
import type { ExtractedField, ExtractOptions } from '../types';
import { field, isValidCalendarDate, labelBefore, pad2 } from '../util';

export const PATTERN_ID = 'date_br_numeric' as const;
export const FIELD_TYPE = 'date' as const;

export const NUMERIC_DATE_REGEX =
  /(?<![\d\-\/.])(\d{1,2})([\/\-.])(\d{1,2})\2(\d{4}|\d{2})(?![\d]|[\/\-.]\d)/g;

export function expandYear(raw: string): number {
  if (raw.length === 4) return Number(raw);
  const n = Number(raw);
  return n < 50 ? 2000 + n : 1900 + n;
}

export function extractDateBR(
  text: string,
  documentId: string,
  pageNumber: number,
  opts: ExtractOptions = {},
): ExtractedField[] {
  const lang = opts.language ?? 'und';
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(NUMERIC_DATE_REGEX)) {
    const day = Number(m[1]);
    const month = Number(m[3]);
    const year = expandYear(m[4] as string);
    if (!isValidCalendarDate(year, month, day)) continue;
    const ambiguous = day <= 12 && month <= 12 && day !== month;
    if (lang === 'en' && ambiguous && m[2] === '/') continue; // vira date_us_numeric
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
          confidence: ambiguous && lang === 'und' ? 0.7 : 0.9,
          sourceKind: 'deterministic',
        },
        labelBefore(text, start),
      ),
    );
  }
  return out;
}
