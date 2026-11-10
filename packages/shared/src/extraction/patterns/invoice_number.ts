/** Pattern invoice_number — docs/heuristics.md §5.1. "NF-e 12345", "Nota Fiscal nº 1.234". */
import type { ExtractedField } from '../types';
import { field } from '../util';

export const PATTERN_ID = 'invoice_number' as const;
export const FIELD_TYPE = 'invoice_number' as const;

const REGEX =
  /(?<![\p{L}\d])(?:NF(?:-?e)?|Nota\s+Fiscal(?:\s+(?:Eletr[ôo]nica|de\s+Servi[çc]os?))?)\s*(?:n[ºo°.]?\s*|n[úu]mero\s*|#\s*)?[:\-]?\s*(\d{1,3}(?:\.\d{3})+|\d{3,15})(?![\d]|[.,]\d)/giu;

export function extractInvoiceNumber(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const start = m.index ?? 0;
    out.push(
      field({
        documentId,
        pageNumber,
        start,
        end: start + m[0].length,
        raw: m[0],
        normalized: (m[1] as string).replace(/\./g, ''),
        fieldType: FIELD_TYPE,
        patternId: PATTERN_ID,
        confidence: 0.8,
        sourceKind: 'heuristic',
      }),
    );
  }
  return out;
}
