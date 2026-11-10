import { describe, expect, it } from 'vitest';
import { extractPhoneMobile, PATTERN_ID } from './phone_br_mobile';

const run = (t: string) => extractPhoneMobile(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each([
    ['(11) 98765-4321', '+55 11 98765-4321', 0.9],
    ['+55 71 99876-5432', '+55 71 99876-5432', 0.9],
    ['71998765432', '+55 71 99876-5432', 0.9],
    ['11 98765 4321', '+55 11 98765-4321', 0.9],
    ['(21)987654321', '+55 21 98765-4321', 0.9],
    ['98765-4321', '98765-4321', 0.7],
  ])('extrai %s', (raw, norm, conf) => {
    const f = run(`Tel ${raw} fim`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      normalized_value: norm,
      confidence: conf,
      field_type: 'phone',
      source_kind: 'deterministic',
    });
  });

  it.each([
    '(00) 98765-4321', // DDD inexistente
    '(10) 98765-4321',
    '11111111111',
    '(11) 88765-4321', // não começa com 9
    '987654321', // sem DDD e sem hífen
    '1.234.567,89', // dinheiro
    '2024-98765-4321',
    'R$98765-4321',
  ])('rejeita %s', (raw) => {
    expect(run(`x ${raw} y`)).toHaveLength(0);
  });

  it('não pega parte de número maior', () => {
    expect(run('protocolo 119876543210')).toHaveLength(0);
  });
});
