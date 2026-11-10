import { describe, expect, it } from 'vitest';
import { extractDateExtenso, PATTERN_ID } from './date_br_extenso';

const run = (t: string) => extractDateExtenso(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each([
    ['10 de dezembro de 2026', '2026-12-10'],
    ['1º de janeiro de 2024', '2024-01-01'],
    ['29 de fevereiro de 2024', '2024-02-29'],
    ['5 de MARÇO de 2023', '2023-03-05'],
    ['5 de marco de 2023', '2023-03-05'],
    ['31 de outubro de 1999', '1999-10-31'],
  ])('extrai %s', (raw, iso) => {
    const f = run(`Salvador, ${raw}.`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      normalized_value: iso,
      confidence: 1,
      source_kind: 'deterministic',
    });
  });

  it.each([
    '30 de fevereiro de 2024',
    '31 de abril de 2024',
    '32 de janeiro de 2024',
    '10 de dezembrio de 2026',
    '10 dezembro 2026',
    '10 de dezembro de 26',
    '10 de dezembro de 1800',
  ])('rejeita %s', (raw) => {
    expect(run(raw)).toHaveLength(0);
  });

  it('rótulo anterior', () => {
    expect(run('Data de assinatura: 10 de dezembro de 2026')[0]!.label).toBe('data de assinatura');
  });
});
