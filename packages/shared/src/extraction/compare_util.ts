/**
 * Utilitários da comparação (Fase 4). Tudo roda no navegador sobre o texto já armazenado;
 * nenhuma função aqui consulta rede nem banco.
 */
import type { PageText } from './analyze';

/** Unidade de comparação textual: uma linha (ou frase, quando a linha é longa). */
export interface Unit {
  text: string;
  /** Texto com espaços colapsados; é o que decide se duas unidades são iguais. */
  norm: string;
  pageNumber: number;
}

/** Limite de unidades por lado (protege o tempo do diff no navegador). */
export const MAX_UNITS = 3000;
const LONG_LINE = 300;

export const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Divide as páginas em linhas não vazias; linhas longas viram frases. */
export function toUnits(pages: PageText[]): Unit[] {
  const out: Unit[] = [];
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  for (const p of sorted) {
    for (const rawLine of p.text.split(/\r?\n/)) {
      const line = collapse(rawLine);
      if (!line) continue;
      const parts = line.length > LONG_LINE ? line.split(/(?<=[.!?;:])\s+/) : [line];
      for (const part of parts) {
        const norm = collapse(part);
        if (norm) out.push({ text: norm, norm, pageNumber: p.pageNumber });
      }
    }
  }
  return out;
}

export interface Context {
  before: string;
  match: string;
  after: string;
}

/** Trecho ao redor de [start, end) para mostrar a origem de um valor. */
export function contextAround(text: string, start: number, end: number, radius = 50): Context {
  return {
    before: collapse(text.slice(Math.max(0, start - radius), start)),
    match: collapse(text.slice(start, end)),
    after: collapse(text.slice(end, end + radius)),
  };
}
