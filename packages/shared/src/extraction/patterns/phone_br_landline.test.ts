import { describe, expect, it } from 'vitest';
import { extractPhoneLandline, PATTERN_ID } from './phone_br_landline';

const run = (t: string) => extractPhoneLandline(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each([
    ['(71) 3456-7890', '+55 71 3456-7890', 0.9],
    ['+55 11 2345-6789', '+55 11 2345-6789', 0.9],
    ['1134567890', '+55 11 3456-7890', 0.9],
    ['(21) 2222 3333', '+55 21 2222-3333', 0.9],
    ['3456-7890', '3456-7890', 0.7],
    ['(61)5555-1234', '+55 61 5555-1234', 0.9],
  ])('extrai %s', (raw, norm, conf) => {
    const f = run(`Fone ${raw} fim`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      normalized_value: norm,
      confidence: conf,
      field_type: 'phone_landline',
    });
  });

  it.each([
    '(00) 3456-7890',
    '(71) 9456-7890', // começa com 9 = celular
    '1111111111',
    '2023-2024', // intervalo de anos
    '3456 7890', // sem DDD e sem hífen
    '(71) 1456-7890', // fixo começa com 2–5
    'R$ 1.234,5678',
  ])('rejeita %s', (raw) => {
    expect(run(`x ${raw} y`)).toHaveLength(0);
  });
});
