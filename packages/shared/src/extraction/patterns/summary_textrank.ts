/**
 * Pattern summary_textrank — docs/heuristics.md §14.1. Resumo EXTRATIVO: devolve frases
 * originais do documento (com página e posição), nunca texto novo.
 * TextRank: grafo de sentenças com similaridade de cosseno sobre TF-IDF; PageRank (d = 0,85).
 */
import { extractAll } from '../analyze';
import { stripAccents } from '../util';

export const PATTERN_ID = 'summary_textrank' as const;
export const SUMMARY_MODES = ['executive', 'topics', 'chronological'] as const;
export type SummaryMode = (typeof SUMMARY_MODES)[number];

export interface SummarySentence {
  pageNumber: number;
  start: number;
  end: number;
  text: string;
  score: number;
  /** Data ISO detectada na frase (modo cronológico). */
  date?: string;
}
export interface SummaryGroup {
  sentences: SummarySentence[];
}
export interface SummaryResult {
  mode: SummaryMode;
  groups: SummaryGroup[];
  /** true se o documento tinha mais frases que o limite de processamento. */
  truncated: boolean;
  sentencesConsidered: number;
}

const MAX_SENTENCES = 500;
const MIN_LEN = 30;
const MAX_LEN = 500;
const STOP = new Set(
  'a o as os um uma de da do das dos em no na nos nas por para com sem sob sobre e ou que se como mais mas ao aos ser foi sao esta este isso the of and to in is for on with by an be as at it from that this are or de la el los las y en un una con del al lo su sus'.split(
    ' ',
  ),
);
const ABBREV = /\b(?:Sr|Sra|Dr|Dra|Art|Arts|Av|Nº|No|nº|n|Inc|Ltda|etc|p|pág|ex|Prof)\.$/i;

export function splitSentences(
  text: string,
  pageNumber: number,
): Array<{ pageNumber: number; start: number; end: number; text: string }> {
  const out: Array<{ pageNumber: number; start: number; end: number; text: string }> = [];
  let start = 0;
  const push = (end: number) => {
    const raw = text.slice(start, end);
    const lead = raw.length - raw.trimStart().length;
    const body = raw.trim().replace(/\s+/g, ' ');
    if (body.length >= MIN_LEN && body.length <= MAX_LEN)
      out.push({
        pageNumber,
        start: start + lead,
        end: start + lead + raw.trim().length,
        text: body,
      });
    start = end;
  };
  const re = /[.!?;]+(?=\s|$)|\n{2,}/g;
  for (const m of text.matchAll(re)) {
    const end = (m.index ?? 0) + m[0].length;
    if (m[0].startsWith('.') && ABBREV.test(text.slice(Math.max(0, end - 8), end))) continue;
    push(end);
  }
  if (start < text.length) push(text.length);
  return out;
}

function terms(sentence: string): string[] {
  return (stripAccents(sentence.toLowerCase()).match(/[a-z]{3,}|\d{2,}/g) ?? []).filter(
    (t) => !STOP.has(t),
  );
}

function rank(sentences: string[]): number[] {
  const n = sentences.length;
  const docs = sentences.map(terms);
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const vecs = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    const v = new Map<string, number>();
    let norm = 0;
    for (const [t, c] of tf) {
      const w = c * Math.log(1 + n / (df.get(t) ?? 1));
      v.set(t, w);
      norm += w * w;
    }
    return { v, norm: Math.sqrt(norm) };
  });
  const sim = (i: number, j: number) => {
    const a = vecs[i] as (typeof vecs)[number];
    const b = vecs[j] as (typeof vecs)[number];
    if (!a.norm || !b.norm) return 0;
    const [small, big] = a.v.size <= b.v.size ? [a.v, b.v] : [b.v, a.v];
    let dot = 0;
    for (const [t, w] of small) dot += w * (big.get(t) ?? 0);
    return dot / (a.norm * b.norm);
  };
  const w: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const s = sim(i, j);
      (w[i] as number[])[j] = s;
      (w[j] as number[])[i] = s;
      out[i] = (out[i] as number) + s;
      out[j] = (out[j] as number) + s;
    }
  let score = new Array<number>(n).fill(1 / n);
  for (let it = 0; it < 30; it++) {
    const next = new Array<number>(n).fill((1 - 0.85) / n);
    for (let i = 0; i < n; i++) {
      if (!out[i]) continue;
      const share = (0.85 * (score[i] as number)) / (out[i] as number);
      for (let j = 0; j < n; j++)
        next[j] = (next[j] as number) + share * ((w[i] as number[])[j] as number);
    }
    score = next;
  }
  return score;
}

export function summarize(
  pages: Array<{ pageNumber: number; text: string }>,
  mode: SummaryMode,
): SummaryResult {
  let all: Array<{ pageNumber: number; start: number; end: number; text: string }> = [];
  for (const p of pages) all = all.concat(splitSentences(p.text, p.pageNumber));
  const truncated = all.length > MAX_SENTENCES;
  if (truncated) all = all.slice(0, MAX_SENTENCES);
  if (all.length === 0) return { mode, groups: [], truncated, sentencesConsidered: 0 };

  const scores = rank(all.map((s) => s.text));
  const scored: SummarySentence[] = all.map((s, i) => ({
    ...s,
    score: Number((scores[i] as number).toFixed(5)),
  }));
  const byRank = [...scored].sort((a, b) => b.score - a.score);
  const inOrder = (xs: SummarySentence[]) =>
    [...xs].sort((a, b) => a.pageNumber - b.pageNumber || a.start - b.start);

  if (mode === 'executive') {
    return {
      mode,
      groups: [{ sentences: inOrder(byRank.slice(0, 5)) }],
      truncated,
      sentencesConsidered: all.length,
    };
  }
  if (mode === 'topics') {
    const top = byRank.slice(0, 10);
    const tv = top.map((s) => new Set(terms(s.text)));
    const groups: number[][] = [];
    top.forEach((_, i) => {
      const g = groups.find((members) => {
        const seed = tv[members[0] as number] as Set<string>;
        const cur = tv[i] as Set<string>;
        let inter = 0;
        for (const t of cur) if (seed.has(t)) inter++;
        return inter / Math.sqrt((seed.size || 1) * (cur.size || 1)) >= 0.2;
      });
      if (g) g.push(i);
      else groups.push([i]);
    });
    return {
      mode,
      groups: groups.map((g) => ({ sentences: inOrder(g.map((i) => top[i] as SummarySentence)) })),
      truncated,
      sentencesConsidered: all.length,
    };
  }
  // cronológico: só frases com data detectada, ordenadas pela data
  const dated: SummarySentence[] = [];
  for (const s of byRank) {
    const dates = extractAll(s.text, 'summary', s.pageNumber, { language: 'und' }).filter(
      (f) => f.field_type === 'date',
    );
    const first = dates[0];
    if (first) dated.push({ ...s, date: first.normalized_value });
    if (dated.length >= 10) break;
  }
  dated.sort(
    (a, b) =>
      (a.date as string).localeCompare(b.date as string) ||
      a.pageNumber - b.pageNumber ||
      a.start - b.start,
  );
  return {
    mode,
    groups: dated.length ? [{ sentences: dated }] : [],
    truncated,
    sentencesConsidered: all.length,
  };
}
