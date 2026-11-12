/**
 * Pattern diff_clause — docs/heuristics.md §13.3.
 * Pareia as cláusulas de dois textos pela chave de numeração (`clause_boundary`) e compara o
 * texto de cada par. Cláusulas sem par com texto muito parecido são sinalizadas como "possível
 * renumeração" e exigem revisão humana. Compara texto: não avalia validade nem efeito jurídico.
 */
import { diffWords } from 'diff';
import type { PageText } from '../analyze';
import { splitClauses, type Clause } from './clause_boundary';
import type { InlinePart } from './diff_textual';

export const PATTERN_ID = 'diff_clause' as const;

export type ClauseDiffStatus =
  'igual' | 'alterada' | 'removida' | 'adicionada' | 'renumerada_possivel';

export interface ComparedClause {
  status: ClauseDiffStatus;
  keyA: string | null;
  keyB: string | null;
  a: Clause | null;
  b: Clause | null;
  /** Diff de palavras (só `alterada`/`renumerada_possivel` com texto diferente e tamanho razoável). */
  inline: InlinePart[] | null;
  /** Similaridade de palavras (Jaccard) das renumerações possíveis. */
  similarity: number | null;
  /** true quando só uma pessoa pode confirmar (renumeração possível). */
  needsHumanReview: boolean;
}

export interface ClauseComparison {
  clauses: ComparedClause[];
  stats: Record<ClauseDiffStatus, number>;
  countA: number;
  countB: number;
  duplicateKeysA: string[];
  duplicateKeysB: string[];
}

/** Similaridade mínima (Jaccard de palavras) para sugerir renumeração. */
export const RENUMBER_MIN_SIMILARITY = 0.8;
/** Acima disso o diff de palavras é omitido (custo no navegador). */
const MAX_INLINE_CHARS = 20_000;

const words = (s: string): Set<string> => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

function inline(a: string, b: string): InlinePart[] | null {
  if (a.length > MAX_INLINE_CHARS || b.length > MAX_INLINE_CHARS) return null;
  return diffWords(a, b).map((p) => ({
    kind: p.added ? 'added' : p.removed ? 'removed' : 'same',
    text: p.value,
  }));
}

export function diffClauses(pagesA: PageText[], pagesB: PageText[]): ClauseComparison {
  const sa = splitClauses(pagesA);
  const sb = splitClauses(pagesB);
  const byKeyB = new Map(sb.clauses.map((c) => [c.key, c]));
  const usedB = new Set<string>();
  const rows: ComparedClause[] = [];
  const unmatchedA: Clause[] = [];

  for (const a of sa.clauses) {
    const b = byKeyB.get(a.key);
    if (!b) {
      unmatchedA.push(a);
      continue;
    }
    usedB.add(b.key);
    const same = a.text === b.text;
    rows.push({
      status: same ? 'igual' : 'alterada',
      keyA: a.key,
      keyB: b.key,
      a,
      b,
      inline: same ? null : inline(a.text, b.text),
      similarity: null,
      needsHumanReview: false,
    });
  }

  const unmatchedB = sb.clauses.filter((c) => !usedB.has(c.key));

  // Pareamento guloso por similaridade: o par mais parecido primeiro.
  const candidates: Array<{ a: Clause; b: Clause; sim: number }> = [];
  const wa = new Map(unmatchedA.map((c) => [c.key, words(c.body)]));
  const wb = new Map(unmatchedB.map((c) => [c.key, words(c.body)]));
  for (const a of unmatchedA)
    for (const b of unmatchedB) {
      const sim = jaccard(wa.get(a.key) as Set<string>, wb.get(b.key) as Set<string>);
      if (sim >= RENUMBER_MIN_SIMILARITY) candidates.push({ a, b, sim });
    }
  candidates.sort((x, y) => y.sim - x.sim || x.a.key.localeCompare(y.a.key));
  const pairedA = new Set<string>();
  const pairedB = new Set<string>();
  for (const { a, b, sim } of candidates) {
    if (pairedA.has(a.key) || pairedB.has(b.key)) continue;
    pairedA.add(a.key);
    pairedB.add(b.key);
    rows.push({
      status: 'renumerada_possivel',
      keyA: a.key,
      keyB: b.key,
      a,
      b,
      inline: a.text === b.text ? null : inline(a.text, b.text),
      similarity: Number(sim.toFixed(2)),
      needsHumanReview: true,
    });
  }
  for (const a of unmatchedA.filter((c) => !pairedA.has(c.key)))
    rows.push({
      status: 'removida',
      keyA: a.key,
      keyB: null,
      a,
      b: null,
      inline: null,
      similarity: null,
      needsHumanReview: false,
    });
  for (const b of unmatchedB.filter((c) => !pairedB.has(c.key)))
    rows.push({
      status: 'adicionada',
      keyA: null,
      keyB: b.key,
      a: null,
      b,
      inline: null,
      similarity: null,
      needsHumanReview: false,
    });

  const stats: Record<ClauseDiffStatus, number> = {
    igual: 0,
    alterada: 0,
    removida: 0,
    adicionada: 0,
    renumerada_possivel: 0,
  };
  for (const r of rows) stats[r.status]++;

  // Ordem de leitura: pela posição em B. Cláusulas só de A ficam logo depois da última
  // cláusula anterior de A que tem posição em B.
  const posB = new Map(sb.clauses.map((c, i) => [c.key, i]));
  const bOfA = new Map<string, number>();
  for (const r of rows)
    if (r.keyA !== null && r.keyB !== null) bOfA.set(r.keyA, posB.get(r.keyB) as number);
  const anchor = new Map<string, number>();
  let last = -1;
  for (const a of sa.clauses) {
    last = bOfA.get(a.key) ?? last;
    anchor.set(a.key, last + 0.5);
  }
  const order = (r: ComparedClause) =>
    r.keyB !== null ? (posB.get(r.keyB) as number) : (anchor.get(r.keyA as string) as number);
  rows.sort((x, y) => order(x) - order(y));

  return {
    clauses: rows,
    stats,
    countA: sa.clauses.length,
    countB: sb.clauses.length,
    duplicateKeysA: sa.duplicateKeys,
    duplicateKeysB: sb.duplicateKeys,
  };
}
