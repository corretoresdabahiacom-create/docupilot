/** Pattern phone_br_landline — docs/heuristics.md §2.3. */
import type { ExtractedField } from '../types';
import { allSameDigits, field } from '../util';
import { looksLikeYearRange, VALID_DDD } from '../phones';

export const PATTERN_ID = 'phone_br_landline' as const;
export const FIELD_TYPE = 'phone_landline' as const;

const REGEX =
  /(?<![\d.,\/\-+$])(\+55[\s.]?)?(?:\(?(\d{2})\)?[\s.\-]?)?([2-5]\d{3})[\s\-]?(\d{4})(?![\d]|[.,]\d)/g;

export function extractPhoneLandline(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const ddd = m[2];
    const digits = `${ddd ?? ''}${m[3]}${m[4]}`;
    if (allSameDigits(digits)) continue;
    if (ddd && !VALID_DDD.has(Number(ddd))) continue;
    if (!ddd && (m[1] || !m[0].includes('-'))) continue; // sem DDD: só "NNNN-NNNN"
    if (!ddd && looksLikeYearRange(m[3] as string, m[4] as string)) continue;
    const start = m.index ?? 0;
    const local = `${m[3]}-${m[4]}`;
    out.push(
      field({
        documentId,
        pageNumber,
        start,
        end: start + m[0].length,
        raw: m[0],
        normalized: ddd ? `+55 ${ddd} ${local}` : local,
        fieldType: FIELD_TYPE,
        patternId: PATTERN_ID,
        confidence: ddd ? 0.9 : 0.7,
        sourceKind: 'deterministic',
      }),
    );
  }
  return out;
}
