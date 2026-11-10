/**
 * Pattern cep_strict — docs/heuristics.md §2.4.
 * Com a palavra CEP logo antes: aceita com ou sem hífen (1.0). Isolado: só com hífen (0.5).
 */
import type { ExtractedField } from '../types';
import { field } from '../util';

export const PATTERN_ID = 'cep_strict' as const;
export const FIELD_TYPE = 'cep' as const;

const REGEX = /(?<![\d.\-\/])(\d{5})-?(\d{3})(?![\d]|[.\-\/]\d)/g;
const EXPLICIT = /\bCEP\b\s*(?:n[ºo°.]?\s*)?[:\-]?\s*$/i;

export function extractCEP(text: string, documentId: string, pageNumber: number): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const digits = `${m[1]}${m[2]}`;
    if (Number(digits) < 1_000_000) continue; // faixa válida: 01000-000 a 99999-999
    const start = m.index ?? 0;
    const explicit = EXPLICIT.test(text.slice(Math.max(0, start - 14), start));
    const hyphen = m[0].includes('-');
    if (!explicit && !hyphen) continue;
    out.push(
      field({
        documentId,
        pageNumber,
        start,
        end: start + m[0].length,
        raw: m[0],
        normalized: digits,
        fieldType: FIELD_TYPE,
        patternId: PATTERN_ID,
        confidence: explicit ? 1.0 : 0.5,
        sourceKind: explicit ? 'deterministic' : 'heuristic',
      }),
    );
  }
  return out;
}
