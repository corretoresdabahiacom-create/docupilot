/**
 * Pattern language_detect — docs/heuristics.md §11.1.
 * Contagem de palavras funcionais (pt/en/es) nos primeiros 5.000 caracteres. Não usa `franc`
 * (decisão registrada em docs/heuristics.md): só distingue os três idiomas do produto.
 */
import type { Lang } from '../types';
import { stripAccents } from '../util';

export const PATTERN_ID = 'language_detect' as const;

const STOP: Record<Exclude<Lang, 'und'>, Set<string>> = {
  pt: new Set(
    'de da do das dos que e em um uma para com nao por mais os as se na no nos nas ao como foi sao ser seu sua ou ja entre sobre este esta pelo pela contrato partes conforme'.split(
      ' ',
    ),
  ),
  en: new Set(
    'the of and to in is that for it as with was on be by this are or from at an not have which has will shall agreement between party parties'.split(
      ' ',
    ),
  ),
  es: new Set(
    'de la que el en y los del se las por un para con no una su al lo como mas pero sus le ya este si entre sobre contrato partes segun'.split(
      ' ',
    ),
  ),
};
/** Palavras presentes em mais de um idioma contam para todos; só as exclusivas desempatam. */
const SHARED = new Set<string>();
for (const w of STOP.pt) if (STOP.es.has(w) || STOP.en.has(w)) SHARED.add(w);
for (const w of STOP.es) if (STOP.en.has(w)) SHARED.add(w);

export interface LanguageResult {
  language: Lang;
  /** 0–1: fração das palavras funcionais exclusivas que apontam para o idioma escolhido. */
  confidence: number;
}

export function detectLanguage(text: string): LanguageResult {
  const sample = stripAccents(text.slice(0, 5000).toLowerCase());
  const words = sample.match(/[a-z]+/g) ?? [];
  const score: Record<string, number> = { pt: 0, en: 0, es: 0 };
  for (const w of words) {
    if (SHARED.has(w)) continue;
    for (const lang of ['pt', 'en', 'es'] as const)
      if (STOP[lang].has(w)) score[lang] = (score[lang] ?? 0) + 1;
  }
  const ranked = (['pt', 'en', 'es'] as const)
    .map((l) => [l, score[l] ?? 0] as const)
    .sort((a, b) => b[1] - a[1]);
  const [best, second] = [
    ranked[0] as readonly [Lang, number],
    ranked[1] as readonly [Lang, number],
  ];
  const total = ranked.reduce((s, r) => s + r[1], 0);
  if (best[1] < 5 || best[1] < second[1] * 1.5) return { language: 'und', confidence: 0 };
  return { language: best[0], confidence: Number((best[1] / total).toFixed(2)) };
}
