/** Pattern cpf_strict — docs/heuristics.md §1.1. Só devolve CPFs com dígito verificador válido. */
import type { ExtractedField } from '../types';
import { allSameDigits, field } from '../util';

export const PATTERN_ID = 'cpf_strict' as const;
export const FIELD_TYPE = 'cpf' as const;

/** Rejeita 12+ dígitos seguidos e letras coladas (por \b). */
const REGEX = /(?<![\d.\-\/])(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})(?![\d]|[.\-\/]\d)/g;

export function isValidCPF(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  if (allSameDigits(digits)) return false;
  const d = digits.split('').map(Number) as number[];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (d[i] as number) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  if (rest !== d[9]) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += (d[i] as number) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  return rest === d[10];
}

export function extractCPF(text: string, documentId: string, pageNumber: number): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const normalized = `${m[1]}${m[2]}${m[3]}${m[4]}`;
    if (!isValidCPF(normalized)) continue;
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

/** Casos "regex casou, DV falhou" precedidos da palavra CPF (inconsistência cpf_cnpj_dv_invalid). */
export function findInvalidCPF(text: string): Array<{ start: number; end: number; raw: string }> {
  const out: Array<{ start: number; end: number; raw: string }> = [];
  for (const m of text.matchAll(REGEX)) {
    const start = m.index ?? 0;
    if (!/\bCPF\b[^\d\n]{0,12}$/i.test(text.slice(Math.max(0, start - 20), start))) continue;
    if (isValidCPF(`${m[1]}${m[2]}${m[3]}${m[4]}`)) continue;
    out.push({ start, end: start + m[0].length, raw: m[0] });
  }
  return out;
}
