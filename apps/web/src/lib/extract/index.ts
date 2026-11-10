import { extractDocx } from './docx';
import { extractPdf } from './pdf';
import { extractPlainText } from './text';
import type { ExtractionResult } from './types';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Escolhe o extrator pelo tipo. Imagens não têm texto: vão direto para `needs_ocr`. */
export async function extractFromBlob(blob: Blob, mime: string): Promise<ExtractionResult> {
  if (mime === 'application/pdf') return extractPdf(blob);
  if (mime === DOCX) return extractDocx(blob);
  if (mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/csv') {
    return extractPlainText(blob);
  }
  if (mime === 'image/jpeg' || mime === 'image/png') return { status: 'needs_ocr' };
  return { status: 'extraction_failed', reason: 'unsupported' };
}

export * from './types';
