import { describe, expect, it } from 'vitest';
import { extractCNPJ, findInvalidCNPJ, isValidCNPJ, PATTERN_ID } from './cnpj_strict';

const run = (t: string) => extractCNPJ(t, 'd1', 2);

describe(PATTERN_ID, () => {
  it.each([
    ['11.222.333/0001-81', '11222333000181'],
    ['11222333000181', '11222333000181'],
    ['11.444.777/0001-61', '11444777000161'],
    ['00.000.000/0001-91', '00000000000191'],
    ['33.000.167/0001-01', '33000167000101'],
    ['60.746.948/0001-12', '60746948000112'],
  ])('extrai %s', (raw, norm) => {
    const f = run(`CNPJ ${raw} ativo`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      normalized_value: norm,
      field_type: 'cnpj',
      pattern_id: 'cnpj_strict',
      confidence: 1,
      source_kind: 'deterministic',
      page_number: 2,
    });
  });

  it.each([
    '11.222.333/0001-82', // DV errado
    '00.000.000/0000-00',
    '11.111.111/1111-11', // todos iguais
    '11.222.333/001-81', // curto
    '112223330001811', // 15 dígitos
    'nº 11.222.333/0001', // incompleto
  ])('rejeita %s', (raw) => {
    expect(run(`CNPJ ${raw}`)).toHaveLength(0);
  });

  it('offsets conferem', () => {
    const text = 'Empresa X, CNPJ 11.222.333/0001-81, sede';
    const [f] = run(text);
    expect(text.slice(f!.text_span_start, f!.text_span_end)).toBe('11.222.333/0001-81');
  });

  it('isValidCNPJ exige 14 dígitos puros', () => {
    expect(isValidCNPJ('11222333000181')).toBe(true);
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(false);
    expect(isValidCNPJ('1122233300018')).toBe(false);
  });

  it('findInvalidCNPJ exige a palavra CNPJ antes', () => {
    expect(findInvalidCNPJ('CNPJ: 11.222.333/0001-82')).toHaveLength(1);
    expect(findInvalidCNPJ('CNPJ: 11.222.333/0001-81')).toHaveLength(0);
    expect(findInvalidCNPJ('Ref 11.222.333/0001-82')).toHaveLength(0);
  });
});
