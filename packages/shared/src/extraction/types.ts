/**
 * Tipos compartilhados entre os padrões de extração (docs/heuristics.md §0).
 * O mesmo código roda no navegador (extração) e no Worker (reverificação de cada campo).
 */

export type SourceKind = 'deterministic' | 'heuristic' | 'ocr' | 'ai_external' | 'ocr_external';

export type Lang = 'pt' | 'en' | 'es' | 'und';

export interface ExtractedField {
  document_id: string;
  /** 1-based. */
  page_number: number;
  /** Offset no texto da página (0-based, meio-aberto). */
  text_span_start: number;
  text_span_end: number;
  /** Trecho cru como apareceu no documento. */
  raw_value: string;
  /** Valor normalizado (CPF sem pontuação, data ISO, dinheiro "1234.56 BRL"). */
  normalized_value: string;
  field_type: string;
  /** Chave documentada em docs/heuristics.md. */
  pattern_id: string;
  /** Escala ordenada de docs/heuristics.md §0.2 (não é probabilidade). */
  confidence: number;
  source_kind: SourceKind;
  /** Rótulo imediatamente anterior ("vencimento", "total"), normalizado; só datas e valores. */
  label?: string;
}

export interface ExtractOptions {
  language?: Lang;
}

export type PatternFn = (
  text: string,
  documentId: string,
  pageNumber: number,
  opts?: ExtractOptions,
) => ExtractedField[];

/** Confianças permitidas (docs/heuristics.md §0.2). */
export const CONFIDENCE = {
  exact: 1.0,
  high: 0.9,
  written: 0.8,
  medium: 0.7,
  heuristic: 0.5,
  low: 0.3,
} as const;

/** Abaixo disto o campo é descartado e nunca apresentado. */
export const MIN_CONFIDENCE = 0.3;
