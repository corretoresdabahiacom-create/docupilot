/** Pattern cnpj_strict — docs/heuristics.md §1.2. Só CNPJ numérico com DV válido. */
import type { ExtractedField } from '../types';
import { allSameDigits, field } from '../util';

export const PATTERN_ID = 'cnpj_strict' as const;
export const FIELD_TYPE = 'cnpj' as const;

const REGEX = /(?<![\d.\-\/])(\d{2})\.?(\d{3})\.?(\d{3})\/?(\d{4})-?(\d{2})(?![\d]|[.\-\/]\d)/g;

function dv(base: number[], weights: number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) sum += (base[i] as number) * (weights[i] as number);
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

export function isValidCNPJ(digits: string): boolean {
  if (!/^\d{14}$/.test(digits)) return false;
  if (allSameDigits(digits)) return false;
  const d = digits.split('').map(Number) as number[];
  const d1 = dv(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (d1 !== d[12]) return false;
  return dv(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === d[13];
}

export function extractCNPJ(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const normalized = `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}`;
    if (!isValidCNPJ(normalized)) continue;
    const start = m.index ?? 0;
    out.push(
      field({
        documentId,
        pageNumber,
        start,
        end: start + m[0].length,
        raw: m[0],
        normalized,
        fieldType: FIELD_TYPE,
        patternId: PATTERN_ID,
        confidence: 1.0,
        sourceKind: 'deterministic',
      }),
    );
  }
  return out;
}

export function findInvalidCNPJ(text: string): Array<{ start: number; end: number; raw: string }> {
  const out: Array<{ start: number; end: number; raw: string }> = [];
  for (const m of text.matchAll(REGEX)) {
    const start = m.index ?? 0;
    if (!/\bCNPJ\b[^\d\n]{0,12}$/i.test(text.slice(Math.max(0, start - 20), start))) continue;
    if (isValidCNPJ(`${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}`)) continue;
    out.push({ start, end: start + m[0].length, raw: m[0] });
  }
  return out;
}
