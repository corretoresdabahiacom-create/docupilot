/**
 * Pattern clause_boundary — docs/heuristics.md §6.
 * Segmenta o texto em "cláusulas" por numeração no início da linha: `1.`, `1.1.`, `Art. 5º`,
 * `Cláusula Primeira` / `Cláusula 3ª`. Best effort: não entende o conteúdo, só o cabeçalho.
 * Não é análise jurídica.
 */
import type { PageText } from '../analyze';
import { collapse } from '../compare_util';
import { stripAccents } from '../util';

export const PATTERN_ID = 'clause_boundary' as const;

export interface Clause {
  /** Chave de pareamento ("1.1", "art 5", "clausula primeira"); repetida na mesma versão vira "1.1#2". */
  key: string;
  /** Primeira linha (cabeçalho), até 120 caracteres. */
  heading: string;
  /** Texto completo da cláusula, linhas unidas por espaço. */
  text: string;
  /** `text` sem o marcador de numeração do começo ("1.1.", "Art. 5º"). */
  body: string;
  pageNumber: number;
}

export interface ClauseSplit {
  clauses: Clause[];
  /** Linhas antes do primeiro cabeçalho. */
  preambleLines: number;
  /** Chaves que apareciam mais de uma vez (numeração reiniciada ou erro de extração). */
  duplicateKeys: string[];
}

const ORD = 'primeira|segunda|terceira|quarta|quinta|sexta|s[eé]tima|oitava|nona';
const ARTICLE = /^art(?:igo)?s?\.?\s*(\d{1,4})\s*[º°o]?(?![\p{L}\d])/iu;
const CLAUSE_WORD = new RegExp(
  `^cl[áa]usula\\s+(?:(\\d{1,3})\\s*[ªº°]?(?![\\p{L}\\d])|((?:d[eé]cima|v[ií]gesima|trig[eé]sima)(?:\\s+(?:${ORD}))?|${ORD}|[uú]nica)(?![\\p{L}]))`,
  'iu',
);
// 1–2 dígitos por nível (evita "1.000", "10.05.2024"); um nível exige ponto ("1. Objeto").
const NUMBERED = /^(\d{1,2}(?:\.\d{1,2}){0,4})(\.?)\s+(?=\S)/;

interface HeadingMatch {
  key: string;
  /** Tamanho do marcador no começo da linha. */
  prefixLength: number;
}

function matchHeading(line: string): HeadingMatch | null {
  const art = ARTICLE.exec(line);
  if (art) return { key: `art ${Number(art[1])}`, prefixLength: art[0].length };
  const word = CLAUSE_WORD.exec(line);
  if (word) {
    const key = word[1]
      ? `clausula ${Number(word[1])}`
      : `clausula ${stripAccents((word[2] ?? '').toLowerCase()).replace(/\s+/g, ' ')}`;
    return { key, prefixLength: word[0].length };
  }
  const num = NUMBERED.exec(line);
  if (num) {
    const key = num[1] as string;
    if (!key.includes('.') && num[2] !== '.') return null;
    return { key, prefixLength: num[0].length };
  }
  return null;
}

/** Devolve a chave do cabeçalho se a linha abre uma cláusula. */
export function clauseKey(line: string): string | null {
  return matchHeading(line.trim())?.key ?? null;
}

export function splitClauses(pages: PageText[]): ClauseSplit {
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const clauses: Clause[] = [];
  const seen = new Map<string, number>();
  const duplicates = new Set<string>();
  let preambleLines = 0;
  let current: {
    key: string;
    heading: string;
    prefixLength: number;
    lines: string[];
    pageNumber: number;
  } | null = null;

  const close = () => {
    if (!current) return;
    const text = collapse(current.lines.join(' '));
    clauses.push({
      key: current.key,
      heading: current.heading.slice(0, 120),
      text,
      body: text.slice(current.prefixLength).trim(),
      pageNumber: current.pageNumber,
    });
    current = null;
  };

  for (const p of sorted) {
    for (const raw of p.text.split(/\r?\n/)) {
      const line = collapse(raw);
      if (!line) continue;
      const found = matchHeading(line);
      if (found) {
        close();
        const base = found.key;
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        if (n > 1) duplicates.add(base);
        current = {
          key: n > 1 ? `${base}#${n}` : base,
          prefixLength: found.prefixLength,
          heading: line,
          lines: [line],
          pageNumber: p.pageNumber,
        };
      } else if (current) {
        current.lines.push(line);
      } else {
        preambleLines++;
      }
    }
  }
  close();
  return { clauses, preambleLines, duplicateKeys: [...duplicates].sort() };
}
