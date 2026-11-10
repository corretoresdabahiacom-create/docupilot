import { MAX_CHARS_PER_PAGE, MAX_PAGES_PER_DOCUMENT } from '@docupilot/shared';
import { openPdf } from '../pdf';
import { classifyPdfPages } from './classify';
import type { ExtractionResult } from './types';

/** Camada de texto do PDF (determinístico). PDFs sem texto seguem para `needs_ocr`. */
export async function extractPdf(blob: Blob): Promise<ExtractionResult> {
  let pdf;
  try {
    pdf = await openPdf(await blob.arrayBuffer());
  } catch {
    return { status: 'extraction_failed', reason: 'read_error' };
  }
  try {
    if (pdf.numPages > MAX_PAGES_PER_DOCUMENT) {
      return { status: 'extraction_failed', reason: 'too_many_pages', pageCount: pdf.numPages };
    }
    const texts: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      texts.push(
        content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
          .join('')
          .replace(/[ \t]+/g, ' ')
          .replace(/ ?\n ?/g, '\n'),
      );
      page.cleanup();
    }
    if (texts.some((t) => t.length > MAX_CHARS_PER_PAGE)) {
      return { status: 'extraction_failed', reason: 'page_too_large', pageCount: pdf.numPages };
    }
    return classifyPdfPages(texts);
  } catch {
    return { status: 'extraction_failed', reason: 'read_error' };
  } finally {
    await pdf.loadingTask.destroy();
  }
}
