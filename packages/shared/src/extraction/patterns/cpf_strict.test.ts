import { describe, expect, it } from 'vitest';
import { extractCPF, findInvalidCPF, isValidCPF, PATTERN_ID } from './cpf_strict';

const run = (t: string) => extractCPF(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each([
    ['123.456.789-09', '12345678909'],
    ['12345678909', '12345678909'],
    ['123.456.78909', '12345678909'],
    ['123456789-09', '12345678909'],
    ['529.982.247-25', '52998224725'],
    ['168.995.350-09', '16899535009'],
    ['453.178.287-91', '45317828791'],
  ])('extrai %s', (raw, norm) => {
    const f = run(`O CPF é ${raw}.`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      normalized_value: norm,
      raw_value: raw,
      field_type: 'cpf',
      pattern_id: 'cpf_strict',
      confidence: 1,
      source_kind: 'deterministic',
    });
  });

  it.each([
    '111.111.111-11',
    '123.456.789-10',
    '123.456.789-00',
    '000.000.000-00',
    '123.456.78-09',
    '012345678901', // 12 dígitos
    'protocolo 20240123456789 aberto', // 14 dígitos
  ])('rejeita %s', (raw) => {
    expect(run(raw)).toHaveLength(0);
  });

  it('offsets conferem com o texto', () => {
    const text = 'Sr. João, CPF 123.456.789-09, residente';
    const [f] = run(text);
    expect(text.slice(f!.text_span_start, f!.text_span_end)).toBe('123.456.789-09');
  });

  it('não casa dentro de CNPJ nem de numeração com barras', () => {
    expect(run('CNPJ 11.222.333/0001-81')).toHaveLength(0);
    expect(run('123.456.789-09/2024')).toHaveLength(0);
  });

  it('extrai vários CPFs na ordem', () => {
    const f = run('A: 123.456.789-09 e B: 529.982.247-25');
    expect(f.map((x) => x.normalized_value)).toEqual(['12345678909', '52998224725']);
  });

  it('findInvalidCPF só aponta DV inválido precedido da palavra CPF', () => {
    expect(findInvalidCPF('CPF: 123.456.789-10')).toHaveLength(1);
    expect(findInvalidCPF('CPF: 123.456.789-09')).toHaveLength(0);
    expect(findInvalidCPF('Telefone 123.456.789-10')).toHaveLength(0);
  });

  it('isValidCPF rejeita formato errado', () => {
    expect(isValidCPF('1234567890')).toBe(false);
    expect(isValidCPF('123.456.789-09')).toBe(false);
    expect(isValidCPF('')).toBe(false);
  });
});
