/**
 * Pattern address_br_heuristic — docs/heuristics.md §2.5.
 * tipo de logradouro + nome + número (+ complemento/bairro curto) (+ CEP). Melhor esforço.
 */
import type { ExtractedField } from '../types';
import { field } from '../util';

export const PATTERN_ID = 'address_br_heuristic' as const;
export const FIELD_TYPE = 'address' as const;

const REGEX =
  /(?<![\p{L}])(?:Rua|RUA|R\.|Avenida|AVENIDA|Av\.|AV\.|Travessa|TRAVESSA|Tv\.|Alameda|ALAMEDA|Al\.|Pra[çc]a|PRA[ÇC]A|Rodovia|RODOVIA|Estrada|ESTRADA)[ \t]+[\p{L}0-9][^,\n]{1,60}?,[ \t]*(?:n[ºo°.]?[ \t]*)?(?:\d{1,5}[A-Za-z]?|s\/n)(?:[ \t]*[-,–][ \t]*[^,\n.]{1,40}){0,2}(?:[ \t]*[-,–]?[ \t]*(?:CEP[ \t:]*)?\d{5}-\d{3})?/gu;

export function extractAddressHeuristic(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const raw = m[0].replace(/[ \t,\-–]+$/, '');
    if (raw.length > 200) continue;
    const start = m.index ?? 0;
    out.push(
      field({
        documentId,
        pageNumber,
        start,
        end: start + raw.length,
        raw,
        normalized: raw.replace(/\s+/g, ' ').trim(),
        fieldType: FIELD_TYPE,
        patternId: PATTERN_ID,
        confidence: 0.5,
        sourceKind: 'heuristic',
      }),
    );
  }
  return out;
}
