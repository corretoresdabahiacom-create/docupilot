/** Auxiliares de valores monetários (não é um pattern_id; vive fora de patterns/). */

/**
 * Converte "1.234,56" ou "1,234.56" em "1234.56". O separador decimal é o último `.` ou `,`
 * seguido de 1–2 dígitos; seguido de 3 dígitos é separador de milhar. `null` se ambíguo/inválido.
 */
export function parseAmount(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const sepIdx = Math.max(lastDot, lastComma);
  let intPart = s;
  let frac = '';
  if (sepIdx !== -1) {
    const after = s.slice(sepIdx + 1);
    if (after.length >= 1 && after.length <= 2) {
      intPart = s.slice(0, sepIdx);
      frac = after;
    } else if (after.length !== 3) {
      return null;
    }
  }
  // o que sobra na parte inteira são só separadores de milhar, todos do mesmo tipo e de 3 em 3
  if (/[.,]/.test(intPart)) {
    if (!/^\d{1,3}(?:([.,])\d{3}(?:\1\d{3})*)$/.test(intPart)) return null;
    intPart = intPart.replace(/[.,]/g, '');
  }
  const cents = frac.padEnd(2, '0');
  return `${intPart.replace(/^0+(?=\d)/, '')}.${cents}`;
}

export const money = (amount: string, currency: 'BRL' | 'USD' | 'EUR') => `${amount} ${currency}`;
