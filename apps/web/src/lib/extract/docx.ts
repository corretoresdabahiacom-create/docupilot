import { textToResult } from './text';
import type { ExtractionResult } from './types';

/** Texto bruto do DOCX (mammoth). Layout, tabelas e imagens não são reproduzidos. */
export async function extractDocx(blob: Blob): Promise<ExtractionResult> {
  try {
    const mod = await import('mammoth');
    const mammoth = mod.default ?? mod;
    const { value } = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() });
    return textToResult(value);
  } catch {
    return { status: 'extraction_failed', reason: 'read_error' };
  }
}
