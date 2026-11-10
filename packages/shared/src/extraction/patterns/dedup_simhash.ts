/**
 * Pattern dedup_simhash — docs/heuristics.md §7.2.
 * SimHash de 64 bits sobre shingles de 3 palavras. Distância de Hamming ≤ 6 = "possivelmente
 * similar" (confiança 0.5 sempre). Nunca é chamado de "duplicado".
 */
import { stripAccents } from '../util';

export const PATTERN_ID = 'dedup_simhash' as const;
export const SIMILAR_MAX_DISTANCE = 6;
/** Abaixo disto o texto é curto demais para comparar. */
export const MIN_WORDS = 30;

const MASK = (1n << 64n) - 1n;
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;

function fnv1a64(s: string): bigint {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK;
  }
  // mistura final (avalanche) para que shingles parecidos não gerem hashes parecidos
  h ^= h >> 33n;
  h = (h * 0xff51afd7ed558ccdn) & MASK;
  h ^= h >> 33n;
  return h;
}

export function tokenize(text: string): string[] {
  return stripAccents(text.toLowerCase()).match(/[a-z0-9]+/g) ?? [];
}

/** Hash hexadecimal de 16 caracteres, ou `null` se o texto for curto demais. */
export function simhash64(text: string): string | null {
  const words = tokenize(text);
  if (words.length < MIN_WORDS) return null;
  const weights = new Array<number>(64).fill(0);
  for (let i = 0; i + 3 <= words.length; i++) {
    const h = fnv1a64(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
    for (let b = 0; b < 64; b++)
      weights[b] = (weights[b] as number) + ((h >> BigInt(b)) & 1n ? 1 : -1);
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if ((weights[b] as number) > 0) out |= 1n << BigInt(b);
  return out.toString(16).padStart(16, '0');
}

export function hammingDistance(a: string, b: string): number {
  if (!/^[0-9a-f]{16}$/.test(a) || !/^[0-9a-f]{16}$/.test(b)) throw new Error('simhash inválido');
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

export const isPossiblySimilar = (a: string, b: string) =>
  hammingDistance(a, b) <= SIMILAR_MAX_DISTANCE;
