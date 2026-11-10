/** Utilitários de texto compartilhados entre navegador (extração) e Worker (validação). */

/** Remove caracteres de controle (exceto \n e \t) e normaliza quebras de linha. */
export function sanitizeText(input: string): string {
  return (
    input
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  );
}

export interface GarbageResult {
  garbage: boolean;
  reason: 'empty' | 'too_short' | 'replacement_chars' | 'private_use' | 'low_letter_ratio' | null;
  letterRatio: number;
}

/**
 * Detecta camada de texto inútil em PDFs (fontes sem ToUnicode, OCR ruim embutido).
 * Heurística determinística: não "entende" o texto, só mede sua composição.
 * `minChars` abaixo do qual o texto é considerado vazio demais para julgar.
 */
export function detectTextGarbage(text: string, opts: { minChars?: number } = {}): GarbageResult {
  const minChars = opts.minChars ?? 20;
  const compact = text.replace(/\s+/g, '');
  if (compact.length === 0) return { garbage: true, reason: 'empty', letterRatio: 0 };
  if (compact.length < minChars) return { garbage: true, reason: 'too_short', letterRatio: 0 };

  let letters = 0;
  let replacement = 0;
  let privateUse = 0;
  for (const ch of compact) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0xfffd) replacement++;
    else if ((code >= 0xe000 && code <= 0xf8ff) || code >= 0xf0000) privateUse++;
    else if (/\p{L}|\p{N}/u.test(ch)) letters++;
  }
  const total = [...compact].length;
  const letterRatio = letters / total;
  if (replacement / total > 0.05)
    return { garbage: true, reason: 'replacement_chars', letterRatio };
  if (privateUse / total > 0.2) return { garbage: true, reason: 'private_use', letterRatio };
  if (letterRatio < 0.5) return { garbage: true, reason: 'low_letter_ratio', letterRatio };
  return { garbage: false, reason: null, letterRatio };
}

/** Marcadores de trecho destacado devolvidos pela busca (caracteres de controle removidos na ingestão). */
export const SNIPPET_OPEN = '\u0001';
export const SNIPPET_CLOSE = '\u0002';

export interface SnippetPart {
  text: string;
  match: boolean;
}

/** Converte o snippet marcado em partes; o cliente renderiza como texto (nunca como HTML). */
export function parseSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let rest = snippet;
  while (rest.length > 0) {
    const open = rest.indexOf(SNIPPET_OPEN);
    if (open === -1) {
      parts.push({ text: rest, match: false });
      break;
    }
    if (open > 0) parts.push({ text: rest.slice(0, open), match: false });
    const close = rest.indexOf(SNIPPET_CLOSE, open + 1);
    if (close === -1) {
      parts.push({ text: rest.slice(open + 1), match: true });
      break;
    }
    parts.push({ text: rest.slice(open + 1, close), match: true });
    rest = rest.slice(close + 1);
  }
  return parts.filter((p) => p.text.length > 0);
}

/** Converte a consulta do usuário em expressão FTS5 segura: tokens entre aspas, último com prefixo. */
export function toFtsQuery(q: string): string | null {
  const tokens = q.normalize('NFC').match(/[\p{L}\p{N}]+/gu);
  if (!tokens || tokens.length === 0) return null;
  const limited = tokens.slice(0, 8);
  return limited.map((t, i) => `"${t}"${i === limited.length - 1 ? '*' : ''}`).join(' ');
}

export function extractTokens(q: string): string[] {
  return (q.normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
}
