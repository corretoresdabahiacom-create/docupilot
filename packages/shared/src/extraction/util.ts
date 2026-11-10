import type { ExtractedField, SourceKind } from './types';

export function field(
  base: {
    documentId: string;
    pageNumber: number;
    start: number;
    end: number;
    raw: string;
    normalized: string;
    fieldType: string;
    patternId: string;
    confidence: number;
    sourceKind: SourceKind;
  },
  label?: string | null,
): ExtractedField {
  const f: ExtractedField = {
    document_id: base.documentId,
    page_number: base.pageNumber,
    text_span_start: base.start,
    text_span_end: base.end,
    raw_value: base.raw,
    normalized_value: base.normalized,
    field_type: base.fieldType,
    pattern_id: base.patternId,
    confidence: base.confidence,
    source_kind: base.sourceKind,
  };
  if (label) f.label = label;
  return f;
}

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

const LABEL_RE = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .\/_-]{1,38}?)\s*:\s*(?:R\$|US\$|€|\$)?\s*$/;

/**
 * Rótulo imediatamente antes de `start`, na mesma linha ("Vencimento: 10/12/2026").
 * Devolve minúsculas, sem acento e com espaços normalizados; `null` se não houver rótulo.
 */
export function labelBefore(text: string, start: number): string | null {
  const from = Math.max(0, start - 60);
  let before = text.slice(from, start);
  const nl = before.lastIndexOf('\n');
  if (nl !== -1) before = before.slice(nl + 1);
  const semi = Math.max(before.lastIndexOf(';'), before.lastIndexOf('|'));
  if (semi !== -1) before = before.slice(semi + 1);
  const m = LABEL_RE.exec(before);
  if (!m?.[1]) return null;
  const label = stripAccents(m[1])
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (label.length < 2) return null;
  if (label.split(' ').length > 5) return null;
  return label;
}

/** Janela de texto ao redor de um trecho, usada para contexto e para reverificação no servidor. */
export const VERIFY_WINDOW = 80;

/** Calendário real (rejeita 30/02, 31/04 etc.). */
export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  const dim = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= (dim[month - 1] ?? 0);
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

export const allSameDigits = (digits: string) => /^(\d)\1+$/.test(digits);
