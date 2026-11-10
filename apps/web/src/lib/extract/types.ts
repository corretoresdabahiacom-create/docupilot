export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export type FailureReason =
  'garbage_text' | 'too_many_pages' | 'page_too_large' | 'read_error' | 'unsupported' | 'empty';

/** Resultado de uma extração local. Nunca contém texto inventado: só o que o arquivo trouxe. */
export type ExtractionResult =
  | { status: 'extracted'; pages: ExtractedPage[]; pageKind: 'page' | 'section'; pageCount: number }
  | { status: 'needs_ocr'; pageCount?: number }
  | { status: 'extraction_failed'; reason: FailureReason; pageCount?: number };

export type ExtractedBy = 'client' | 'client_ocr';
