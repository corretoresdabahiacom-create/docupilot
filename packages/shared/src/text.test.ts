import { describe, expect, it } from 'vitest';
import {
  detectTextGarbage,
  parseSnippet,
  sanitizeText,
  SNIPPET_CLOSE,
  SNIPPET_OPEN,
  toFtsQuery,
} from './text';

describe('detectTextGarbage', () => {
  it('aceita texto normal em português', () => {
    const r = detectTextGarbage(
      'Contrato de prestação de serviços firmado em 12/03/2024 entre as partes.',
    );
    expect(r.garbage).toBe(false);
  });
  it('vazio e muito curto', () => {
    expect(detectTextGarbage('   \n ').reason).toBe('empty');
    expect(detectTextGarbage('abc def').reason).toBe('too_short');
  });
  it('caracteres de substituição (fonte sem ToUnicode)', () => {
    expect(detectTextGarbage('�'.repeat(40) + ' abc').reason).toBe('replacement_chars');
  });
  it('área de uso privado', () => {
    expect(detectTextGarbage(''.repeat(30)).reason).toBe('private_use');
  });
  it('símbolos sem letras', () => {
    expect(detectTextGarbage('#$%&*()!@#$%&*()!@#$%&*()!@#$').reason).toBe('low_letter_ratio');
  });
  it('números e tabelas contam como conteúdo', () => {
    expect(detectTextGarbage('1.234,56 2.345,67 3.456,78 4.567,89 5.678,90').garbage).toBe(false);
  });
});

describe('sanitizeText', () => {
  it('remove controles e preserva quebras e tabulações', () => {
    expect(sanitizeText('a\u0001b\r\nc\td\u0000e')).toBe('ab\nc\tde');
  });
});

describe('snippet e consulta', () => {
  it('parseSnippet separa os trechos destacados', () => {
    const parts = parseSnippet(`antes ${SNIPPET_OPEN}alvo${SNIPPET_CLOSE} depois`);
    expect(parts).toEqual([
      { text: 'antes ', match: false },
      { text: 'alvo', match: true },
      { text: ' depois', match: false },
    ]);
  });
  it('toFtsQuery neutraliza operadores', () => {
    expect(toFtsQuery('foo AND "bar" OR * baz:')).toBe('"foo" "AND" "bar" "OR" "baz"*');
    expect(toFtsQuery('***')).toBeNull();
  });
});
