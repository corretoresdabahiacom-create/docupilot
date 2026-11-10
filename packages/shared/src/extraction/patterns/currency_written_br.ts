/**
 * Pattern currency_written_br — docs/heuristics.md §4.4.
 * "um mil duzentos e trinta e quatro reais e cinquenta centavos" → "1234.50 BRL".
 * Parser próprio de numeral por extenso (até 999 bilhões). Construções fora da gramática
 * regular (ex.: "mil mil", "cem e dois") são rejeitadas em vez de adivinhadas.
 */
import type { ExtractedField } from '../types';
import { money } from '../money';
import { field, labelBefore, stripAccents } from '../util';

export const PATTERN_ID = 'currency_written_br' as const;
export const FIELD_TYPE = 'money' as const;

const UNITS: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
};
const TENS: Record<string, number> = {
  vinte: 20,
  trinta: 30,
  quarenta: 40,
  cinquenta: 50,
  sessenta: 60,
  setenta: 70,
  oitenta: 80,
  noventa: 90,
};
const HUNDREDS: Record<string, number> = {
  cem: 100,
  cento: 100,
  duzentos: 200,
  duzentas: 200,
  trezentos: 300,
  trezentas: 300,
  quatrocentos: 400,
  quatrocentas: 400,
  quinhentos: 500,
  quinhentas: 500,
  seiscentos: 600,
  seiscentas: 600,
  setecentos: 700,
  setecentas: 700,
  oitocentos: 800,
  oitocentas: 800,
  novecentos: 900,
  novecentas: 900,
};
const SCALES: Record<string, number> = {
  mil: 1e3,
  milhao: 1e6,
  milhoes: 1e6,
  bilhao: 1e9,
  bilhoes: 1e9,
};

const WORD_LIST = [
  ...Object.keys(UNITS),
  ...Object.keys(TENS),
  ...Object.keys(HUNDREDS),
  ...Object.keys(SCALES),
  'três',
  'milhão',
  'milhões',
  'bilhão',
  'bilhões',
];
const WORDS = WORD_LIST.sort((a, b) => b.length - a.length).join('|');
const NUM = `(?:${WORDS})(?:\\s+(?:e\\s+)?(?:${WORDS}))*`;
const REGEX = new RegExp(
  `(?<![\\p{L}])(${NUM})\\s+(?:reais|real)(?:\\s+e\\s+(${NUM})\\s+centavos?)?(?![\\p{L}])`,
  'giu',
);

/** Converte tokens de numeral por extenso. `null` se a sequência não for gramatical. */
export function parseWrittenNumber(words: string): number | null {
  const tokens = stripAccents(words.toLowerCase())
    .split(/\s+/)
    .filter((t) => t && t !== 'e');
  if (tokens.length === 0) return null;
  if (tokens.includes('zero')) return tokens.length === 1 ? 0 : null;

  let total = 0;
  let current = 0; // grupo 0–999 em construção
  let hundreds = false;
  let tens = false;
  let unit = false;
  let closed = false; // "cem" e 10–19 encerram o grupo
  let lastScale = Infinity;

  for (const t of tokens) {
    const scale = SCALES[t];
    if (scale !== undefined) {
      if (scale >= lastScale) return null; // "mil mil", "milhão mil milhão"
      if (current === 0 && scale !== 1e3) return null; // "milhão" exige "um milhão"
      total += (current === 0 ? 1 : current) * scale;
      lastScale = scale;
      current = 0;
      hundreds = tens = unit = closed = false;
      continue;
    }
    if (closed) return null;
    const h = HUNDREDS[t];
    const te = TENS[t];
    const u = UNITS[t];
    if (h !== undefined) {
      if (hundreds || tens || unit) return null;
      current += h;
      hundreds = true;
      if (t === 'cem') closed = true;
    } else if (te !== undefined) {
      if (tens || unit) return null;
      current += te;
      tens = true;
    } else if (u !== undefined) {
      if (unit) return null;
      if (u >= 10) {
        if (tens) return null;
        closed = true;
      }
      current += u;
      unit = true;
    } else {
      return null;
    }
  }
  const value = total + current;
  return Number.isSafeInteger(value) ? value : null;
}

export function extractCurrencyWrittenBR(
  text: string,
  documentId: string,
  pageNumber: number,
): ExtractedField[] {
  const out: ExtractedField[] = [];
  for (const m of text.matchAll(REGEX)) {
    const reais = parseWrittenNumber(m[1] as string);
    if (reais === null) continue;
    let cents = 0;
    if (m[2]) {
      const c = parseWrittenNumber(m[2]);
      if (c === null || c > 99) continue;
      cents = c;
    }
    const start = m.index ?? 0;
    out.push(
      field(
        {
          documentId,
          pageNumber,
          start,
          end: start + m[0].length,
          raw: m[0],
          normalized: money(`${reais}.${String(cents).padStart(2, '0')}`, 'BRL'),
          fieldType: FIELD_TYPE,
          patternId: PATTERN_ID,
          confidence: 0.8,
          sourceKind: 'heuristic',
        },
        labelBefore(text, start),
      ),
    );
  }
  return out;
}
