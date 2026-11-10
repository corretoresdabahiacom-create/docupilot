/** Menções a "Anexo I/II/…" e correspondência com nomes de arquivos do workspace. */
import { stripAccents } from './util';

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10 };

function romanToInt(s: string): number | null {
  if (!/^[ivx]+$/i.test(s)) return null;
  let total = 0;
  const v = s
    .toLowerCase()
    .split('')
    .map((c) => ROMAN[c] as number);
  for (let i = 0; i < v.length; i++) {
    const cur = v[i] as number;
    const next = v[i + 1] ?? 0;
    total += cur < next ? -cur : cur;
  }
  // rejeita grafias inválidas ("iiii", "vv"): reescrever o número em romano tem de dar o mesmo texto
  return total >= 1 && total <= 39 && toRoman(total) === s.toLowerCase() ? total : null;
}

function toRoman(n: number): string {
  const map: Array<[number, string]> = [
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let out = '';
  for (const [v, s] of map)
    while (n >= v) {
      out += s;
      n -= v;
    }
  return out;
}

/** "I" → "1", "02" → "2", "A" → "a". `null` se o token não for um identificador de anexo. */
export function annexKey(token: string): string | null {
  if (/^\d{1,2}$/.test(token)) return String(Number(token));
  const r = romanToInt(token);
  if (r !== null) return String(r);
  return /^[A-Za-z]$/.test(token) ? token.toLowerCase() : null;
}

const MENTION =
  /(?<![\p{L}])(?:Anexo|ANEXO)[ \t]+(?:n[ºo°.]?[ \t]*)?([IVX]{1,6}|\d{1,2}|[A-Z])(?![\p{L}\d])/gu;

export function findAnnexMentions(
  text: string,
): Array<{ start: number; end: number; raw: string; key: string }> {
  const out: Array<{ start: number; end: number; raw: string; key: string }> = [];
  for (const m of text.matchAll(MENTION)) {
    const key = annexKey(m[1] as string);
    if (!key) continue;
    const start = m.index ?? 0;
    out.push({ start, end: start + m[0].length, raw: m[0], key });
  }
  return out;
}

/** Chave de anexo declarada no NOME de um arquivo ("Anexo I - Planilha.pdf"), se houver. */
export function annexKeyFromFileName(name: string): string | null {
  const m = /anexo(?![a-z])[\s_\-.]*(?:n[o.º°]?[\s_\-.]*)?0*([ivx]+|\d+|[a-z])(?![a-z0-9])/i.exec(
    stripAccents(name),
  );
  return m ? annexKey((m[1] as string).replace(/^0+(?=\d)/, '')) : null;
}
