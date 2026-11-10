import { detectTextGarbage, MAX_CHARS_PER_PAGE, MAX_PAGES_PER_DOCUMENT } from '@docupilot/shared';
import { splitIntoSections } from './sections';
import type { ExtractionResult } from './types';

/** UTF-8 estrito; se falhar (CSV/TXT do Excel costuma ser Windows-1252), usa Windows-1252. */
export function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
      .decode(bytes)
      .replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Converte texto bruto em seções, aplicando os limites do servidor. */
export function textToResult(text: string): ExtractionResult {
  const sections = splitIntoSections(text, Math.min(6000, MAX_CHARS_PER_PAGE));
  if (sections.length === 0) return { status: 'extraction_failed', reason: 'empty' };
  if (sections.length > MAX_PAGES_PER_DOCUMENT) {
    return { status: 'extraction_failed', reason: 'too_many_pages', pageCount: sections.length };
  }
  const verdict = detectTextGarbage(text, { minChars: 1 });
  if (verdict.reason === 'replacement_chars' || verdict.reason === 'private_use') {
    return { status: 'extraction_failed', reason: 'garbage_text' };
  }
  return {
    status: 'extracted',
    pageKind: 'section',
    pageCount: sections.length,
    pages: sections.map((t, i) => ({ pageNumber: i + 1, text: t })),
  };
}

export async function extractPlainText(blob: Blob): Promise<ExtractionResult> {
  return textToResult(decodeText(await blob.arrayBuffer()));
}
