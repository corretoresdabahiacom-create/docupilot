/** Pattern phone_br_mobile — docs/heuristics.md §2.2. */
import type { ExtractedField } from '../types';
import { allSameDigits, field } from '../util';
import { VALID_DDD } from '../phones';

export const PATTERN_ID = 'phone_br_mobile' as const;
export const FIELD_TYPE = 'phone' as const;

/** Grupos: 1=+55, 2=DDD, 3=9XXXX, 4=XXXX. Não casa dentro de outro número. */
const REGEX =
  /(?<![\d.,\/\-+$])(\+55[\s.]?)?(?:\(?(\d{2})\)?[\s.\-]?)?(9\d{4})[\s\-]?(\d{4})(?![\d]|[.,]\d)/g;

export function extractPhoneMobile(
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
    if (!ddd && (m[1] || !m[0].includes('-'))) continue; // sem DDD: só "9XXXX-XXXX"
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
