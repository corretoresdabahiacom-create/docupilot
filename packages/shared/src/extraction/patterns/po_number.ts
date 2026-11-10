/** Pattern po_number — docs/heuristics.md §5.3. "Pedido nº PC-2024-001", "Purchase Order: 4500012345". */
import type { ExtractedField } from '../types';
import { field } from '../util';

export const PATTERN_ID = 'po_number' as const;
export const FIELD_TYPE = 'po_number' as const;

const REGEX =
  /(?<![\p{L}\d])(?:Purchase\s+Order|Ordem\s+de\s+Compra|Pedido(?:\s+de\s+Compra)?|PO|OC)\s*(?:n[ºo°.]?\s*|#\s*)?[:\-]?\s*([A-Za-z0-9][A-Za-z0-9\-\/]{3,19})(?![A-Za-z0-9])/giu;

export function extractPONumber(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const value = m[1] as string;
    if (!/\d/.test(value)) continue; // "Pedido anterior" não é número de pedido
    const start = m.index ?? 0;
    out.push(
      field({
        documentId,
        pageNumber,
        start,
        end: start + m[0].length,
        raw: m[0],
        normalized: value.toUpperCase(),
        fieldType: FIELD_TYPE,
        patternId: PATTERN_ID,
        confidence: 0.7,
        sourceKind: 'heuristic',
      }),
    );
  }
  return out;
}
