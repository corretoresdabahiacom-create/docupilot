/** Pattern process_number_br — docs/heuristics.md §5.2. Numeração única CNJ com DV (mod 97). */
import type { ExtractedField } from '../types';
import { field } from '../util';

export const PATTERN_ID = 'process_number_br' as const;
export const FIELD_TYPE = 'process_number' as const;

const REGEX = /(?<![\d.\-])(\d{7})-(\d{2})\.(\d{4})\.(\d)\.(\d{2})\.(\d{4})(?![\d]|[.\-]\d)/g;

/** DV = 98 − ((NNNNNNN AAAA JTR OOOO 00) mod 97). */
export function cnjCheckDigits(n: string, year: string, j: string, tr: string, o: string): string {
  const base = `${n}${year}${j}${tr}${o}00`;
  let rem = 0;
  for (const ch of base) rem = (rem * 10 + Number(ch)) % 97;
  return String(98 - rem).padStart(2, '0');
}

export function extractProcessNumber(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const [, n, dv, year, j, tr, o] = m as unknown as string[];
    if (cnjCheckDigits(n as string, year as string, j as string, tr as string, o as string) !== dv)
      continue;
    const start = m.index ?? 0;
    out.push(
      field({
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
      }),
    );
  }
  return out;
}
