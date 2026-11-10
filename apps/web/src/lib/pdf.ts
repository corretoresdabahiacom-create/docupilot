import type { PDFDocumentProxy } from 'pdfjs-dist';

let ready: Promise<typeof import('pdfjs-dist')> | null = null;

/** Carrega o pdfjs sob demanda (fora do bundle principal) e registra o worker empacotado. */
export function loadPdfjs() {
  ready ??= (async () => {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return ready;
}

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs();
  // O arquivo é tratado como dado: sem scripts nem XFA (o pdfjs 6 já não usa eval).
  return pdfjs.getDocument({ data: new Uint8Array(data), enableXfa: false }).promise;
}
