/**
 * Pattern diff_textual — docs/heuristics.md §13.1.
 * Diff por linha/frase (`diff`, Myers) entre dois textos extraídos, com diff de palavras dentro
 * dos pares substituídos. Compara texto, não significado: não diz se uma mudança é relevante.
 */
import { diffArrays, diffWords } from 'diff';
import type { PageText } from '../analyze';
import { MAX_UNITS, toUnits, type Unit } from '../compare_util';

export const PATTERN_ID = 'diff_textual' as const;

export interface InlinePart {
  kind: 'same' | 'removed' | 'added';
  text: string;
}

export interface TextHunk {
  kind: 'equal' | 'removed' | 'added' | 'changed';
  a: Unit[];
  b: Unit[];
  /** Só em `changed` com o mesmo número de unidades dos dois lados: um diff de palavras por par. */
  inline?: InlinePart[][];
}

export interface TextDiff {
  hunks: TextHunk[];
  stats: { equal: number; removed: number; added: number; changed: number };
  /** equal / max(unidades A, unidades B); 1 quando os dois lados estão vazios. */
  similarity: number;
  unitsA: number;
  unitsB: number;
  /** O lado foi cortado em MAX_UNITS unidades. */
  truncated: { a: boolean; b: boolean };
}

const words = (s: string): Set<string> => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Similaridade mínima de palavras para tratar duas linhas de blocos desiguais como a mesma. */
export const PAIR_MIN_SIMILARITY = 0.3;
/** Acima disto (m × n) o alinhamento fino é pulado: o bloco vira removido + adicionado. */
const MAX_ALIGN_CELLS = 250_000;

type Op = { t: 'pair'; i: number; j: number } | { t: 'del'; i: number } | { t: 'add'; j: number };

/**
 * Bloco substituído (linhas removidas + linhas adicionadas). Com o mesmo tamanho, as linhas
 * são pareadas por posição. Com tamanhos diferentes (edição ao lado de uma inclusão, por
 * exemplo), um alinhamento monótono por similaridade de palavras escolhe os pares.
 */
function alignBlock(
  a: Unit[],
  b: Unit[],
): { hunks: TextHunk[]; stats: { changed: number; removed: number; added: number } } {
  const ops: Op[] = [];
  if (a.length === b.length) {
    a.forEach((_, k) => ops.push({ t: 'pair', i: k, j: k }));
  } else if (a.length * b.length > MAX_ALIGN_CELLS) {
    a.forEach((_, i) => ops.push({ t: 'del', i }));
    b.forEach((_, j) => ops.push({ t: 'add', j }));
  } else {
    const wa = a.map((u) => words(u.norm));
    const wb = b.map((u) => words(u.norm));
    const m = a.length;
    const n = b.length;
    const sim = (i: number, j: number) => {
      const s = jaccard(wa[i] as Set<string>, wb[j] as Set<string>);
      return s >= PAIR_MIN_SIMILARITY ? s : 0;
    };
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++) {
        const s = sim(i - 1, j - 1);
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!, s > 0 ? dp[i - 1]![j - 1]! + s : 0);
      }
    const rev: Op[] = [];
    let i = m;
    let j = n;
    while (i > 0 || j > 0) {
      if (
        i > 0 &&
        j > 0 &&
        sim(i - 1, j - 1) > 0 &&
        dp[i]![j] === dp[i - 1]![j - 1]! + sim(i - 1, j - 1)
      ) {
        rev.push({ t: 'pair', i: i - 1, j: j - 1 });
        i--;
        j--;
      } else if (i > 0 && (j === 0 || dp[i]![j] === dp[i - 1]![j]!)) {
        rev.push({ t: 'del', i: i - 1 });
        i--;
      } else {
        rev.push({ t: 'add', j: j - 1 });
        j--;
      }
    }
    ops.push(...rev.reverse());
  }

  // Em cada trecho sem pares, removidas vêm antes das adicionadas (ordem de leitura estável).
  for (let k = 0; k < ops.length;) {
    if (ops[k]?.t === 'pair') {
      k++;
      continue;
    }
    let end = k;
    while (end < ops.length && ops[end]?.t !== 'pair') end++;
    const run = ops.slice(k, end);
    ops.splice(
      k,
      end - k,
      ...run.filter((o) => o.t === 'del'),
      ...run.filter((o) => o.t === 'add'),
    );
    k = end;
  }

  const hunks: TextHunk[] = [];
  const stats = { changed: 0, removed: 0, added: 0 };
  let cur: TextHunk | null = null;
  const flush = () => {
    if (cur) hunks.push(cur);
    cur = null;
  };
  for (const op of ops) {
    if (op.t === 'pair') {
      if (cur?.kind !== 'changed') {
        flush();
        cur = { kind: 'changed', a: [], b: [], inline: [] };
      }
      const ua = a[op.i] as Unit;
      const ub = b[op.j] as Unit;
      cur.a.push(ua);
      cur.b.push(ub);
      cur.inline?.push(inlineParts(ua.text, ub.text));
      stats.changed++;
    } else if (op.t === 'del') {
      if (cur?.kind !== 'removed') {
        flush();
        cur = { kind: 'removed', a: [], b: [] };
      }
      cur.a.push(a[op.i] as Unit);
      stats.removed++;
    } else {
      if (cur?.kind !== 'added') {
        flush();
        cur = { kind: 'added', a: [], b: [] };
      }
      cur.b.push(b[op.j] as Unit);
      stats.added++;
    }
  }
  flush();
  return { hunks, stats };
}

function inlineParts(a: string, b: string): InlinePart[] {
  return diffWords(a, b).map((p) => ({
    kind: p.added ? 'added' : p.removed ? 'removed' : 'same',
    text: p.value,
  }));
}

export function diffText(pagesA: PageText[], pagesB: PageText[]): TextDiff {
  const allA = toUnits(pagesA);
  const allB = toUnits(pagesB);
  const a = allA.slice(0, MAX_UNITS);
  const b = allB.slice(0, MAX_UNITS);
  const parts = diffArrays(a, b, { comparator: (l: Unit, r: Unit) => l.norm === r.norm });

  const hunks: TextHunk[] = [];
  const stats = { equal: 0, removed: 0, added: 0, changed: 0 };
  // Posição em cada lado: partes iguais carregam só um dos lados, então fatiamos pelos índices
  // para que cada lado mantenha as suas próprias páginas.
  let ia = 0;
  let ib = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const n = part.value.length;
    if (!part.added && !part.removed) {
      hunks.push({ kind: 'equal', a: a.slice(ia, ia + n), b: b.slice(ib, ib + n) });
      stats.equal += n;
      ia += n;
      ib += n;
      continue;
    }
    const next = parts[i + 1];
    if (part.removed && next?.added) {
      const block = alignBlock(part.value, next.value);
      for (const h of block.hunks) hunks.push(h);
      stats.changed += block.stats.changed;
      stats.removed += block.stats.removed;
      stats.added += block.stats.added;
      ia += part.value.length;
      ib += next.value.length;
      i++;
    } else if (part.removed) {
      hunks.push({ kind: 'removed', a: part.value, b: [] });
      stats.removed += n;
      ia += n;
    } else {
      hunks.push({ kind: 'added', a: [], b: part.value });
      stats.added += n;
      ib += n;
    }
  }

  const denom = Math.max(a.length, b.length);
  return {
    hunks,
    stats,
    similarity: denom === 0 ? 1 : Number((stats.equal / denom).toFixed(2)),
    unitsA: a.length,
    unitsB: b.length,
    truncated: { a: allA.length > MAX_UNITS, b: allB.length > MAX_UNITS },
  };
}
