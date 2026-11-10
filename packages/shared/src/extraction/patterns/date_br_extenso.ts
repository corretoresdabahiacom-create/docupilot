/** Pattern date_br_extenso — docs/heuristics.md §3.2. "10 de dezembro de 2026". */
import type { ExtractedField } from '../types';
import { field, isValidCalendarDate, labelBefore, pad2, stripAccents } from '../util';

export const PATTERN_ID = 'date_br_extenso' as const;
export const FIELD_TYPE = 'date' as const;

const MONTHS = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

const REGEX =
  /(?<![\d])(\d{1,2})\s?[ºo°]?\s+de\s+(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(\d{4})(?![\d])/gi;

export function extractDateExtenso(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const month = MONTHS.indexOf(stripAccents((m[2] as string).toLowerCase())) + 1;
    const day = Number(m[1]);
    const year = Number(m[3]);
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
          confidence: 1.0,
          sourceKind: 'deterministic',
        },
        labelBefore(text, start),
      ),
    );
  }
  return out;
}
