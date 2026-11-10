import { describe, expect, it } from 'vitest';
import { extractEmail, PATTERN_ID } from './email_strict';

const run = (t: string) => extractEmail(t, 'd1', 1);

describe(PATTERN_ID, () => {
  it.each([
    'maria@exemplo.com.br',
    'joao.silva+nf@empresa.com',
    'a_b-c%d@sub.dominio.org',
    'CONTATO@EXEMPLO.COM',
    'x@y.io',
    'nome123@mail-server.net',
  ])('extrai %s', (e) => {
    const f = run(`Contato: ${e}.`);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      raw_value: e,
      normalized_value: e.toLowerCase(),
      confidence: 0.9,
      source_kind: 'deterministic',
      field_type: 'email',
    });
  });

  it.each([
    'sem arroba.com',
    '@semlocal.com',
    'a@b',
    'a@.com',
    'a..b@c.com',
    '.a@b.com',
    'nome@dominio..com',
  ])('rejeita %s', (t) => {
    expect(run(t)).toHaveLength(0);
  });

  it('não inclui ponto final da frase', () => {
    expect(run('escreva para a@b.com.')[0]!.raw_value).toBe('a@b.com');
  });

  it('vários e-mails', () => {
    expect(run('a@b.com, c@d.org').map((f) => f.raw_value)).toEqual(['a@b.com', 'c@d.org']);
  });
});
