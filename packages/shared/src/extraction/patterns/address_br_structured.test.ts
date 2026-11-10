import { describe, expect, it } from 'vitest';
import { extractAddressStructured, PATTERN_ID } from './address_br_structured';

const run = (t: string) => extractAddressStructured(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it('extrai bloco rotulado completo', () => {
    const text =
      'Dados:\nLogradouro: Rua das Flores, 123\nBairro: Centro\nCidade: Salvador\nEstado: BA\nCEP: 40020-000\nFim';
    const f = run(text);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      normalized_value: 'Rua das Flores, 123, Centro, Salvador, BA, 40020-000',
      confidence: 0.9,
      source_kind: 'deterministic',
      field_type: 'address',
    });
    expect(text.slice(f[0]!.text_span_start, f[0]!.text_span_end)).toBe(f[0]!.raw_value);
    expect(f[0]!.raw_value.startsWith('Logradouro:')).toBe(true);
    expect(f[0]!.raw_value.endsWith('40020-000')).toBe(true);
  });

  it.each([
    'Endereço: Av. Sete, 10\nCidade: Salvador',
    'Logradouro: Rua A, 1\nMunicípio: Recife\nUF: PE',
    'Logradouro: Rua A, 1\nCEP: 01310-100',
    'ENDEREÇO: Rua B, 2\nBAIRRO: X\nCIDADE: Y',
    'Logradouro: Rua C, 3\nBairro: Z\nCEP: 70040-010',
  ])('extrai "%s"', (t) => {
    expect(run(t)).toHaveLength(1);
  });

  it.each([
    'Logradouro: Rua A, 1', // só logradouro
    'Bairro: Centro\nCidade: Salvador', // sem logradouro
    'Cidade: Salvador\nEstado: BA',
    'Logradouro: Rua A, 1\n\n\n\nCidade: Salvador', // blocos distantes
    'Endereço eletrônico: a@b.com',
    'sem rótulos, Rua A 12',
  ])('rejeita "%s"', (t) => {
    expect(run(t)).toHaveLength(0);
  });
});
