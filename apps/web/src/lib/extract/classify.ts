import { detectTextGarbage } from '@docupilot/shared';
import type { ExtractionResult } from './types';

/** Abaixo disto, a média de caracteres por página indica PDF escaneado (sem camada de texto). */
export const MIN_AVG_CHARS_PER_PAGE = 25;

/**
 * Decide o destino de um PDF a partir do texto de cada página:
 * - quase nenhum texto → `needs_ocr` (provável digitalização);
 * - texto presente porém ilegível (fonte sem mapeamento, símbolos) → `extraction_failed`;
 * - caso contrário → `extracted`.
 */
export function classifyPdfPages(pageTexts: string[]): ExtractionResult {
  const pageCount = pageTexts.length;
  const trimmed = pageTexts.map((t) => t.trim());
  const total = trimmed.reduce((n, t) => n + t.length, 0);
  if (pageCount === 0 || total / pageCount < MIN_AVG_CHARS_PER_PAGE) {
    return { status: 'needs_ocr', pageCount };
  }
  const verdict = detectTextGarbage(trimmed.join('\n'));
  if (verdict.garbage) return { status: 'extraction_failed', reason: 'garbage_text', pageCount };
  return {
    status: 'extracted',
    pageKind: 'page',
    pageCount,
    pages: trimmed.map((text, i) => ({ pageNumber: i + 1, text })).filter((p) => p.text.length > 0),
  };
}
