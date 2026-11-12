import { describe, expect, it } from 'vitest';
import { diffClauses, PATTERN_ID } from './diff_clause';

const page = (text: string, pageNumber = 1) => ({ pageNumber, text });
const status = (a: string, b: string) =>
  diffClauses([page(a)], [page(b)]).clauses.map((c) => c.status);

describe(PATTERN_ID, () => {
  it('cláusulas idênticas: igual', () => {
    expect(status('1. Objeto\nX', '1. Objeto\nX')).toEqual(['igual']);
  });

  it('mesma numeração, texto diferente: alterada com diff de palavras', () => {
    const r = diffClauses(
      [page('1. Prazo\nO prazo é de 30 dias.')],
      [page('1. Prazo\nO prazo é de 45 dias.')],
    );
    expect(r.clauses[0]?.status).toBe('alterada');
    const removed = r.clauses[0]?.inline
      ?.filter((p) => p.kind === 'removed')
      .map((p) => p.text.trim());
    expect(removed).toEqual(['30']);
  });

  it('cláusula só em A: removida; só em B: adicionada', () => {
    const r = diffClauses(
      [page('1. Objeto\nalfa beta\n2. Foro\ngama delta epsilon')],
      [page('1. Objeto\nalfa beta\n3. Multa\nzeta eta theta iota')],
    );
    const s = r.clauses.map((c) => `${c.keyA ?? '-'}>${c.keyB ?? '-'}:${c.status}`);
    expect(s).toContain('2>-:removida');
    expect(s).toContain('->3:adicionada');
    expect(r.stats.igual).toBe(1);
  });

  it('texto igual com outra numeração: possível renumeração, exige revisão humana', () => {
    const body =
      'O contratado entregará os serviços descritos no anexo no prazo combinado entre as partes';
    const r = diffClauses([page(`1. ${body}`)], [page(`2. ${body}`)]);
    expect(r.clauses[0]).toMatchObject({
      status: 'renumerada_possivel',
      keyA: '1',
      keyB: '2',
      needsHumanReview: true,
      similarity: 1,
    });
  });

  it('textos muito diferentes com numeração diferente: não renumeração', () => {
    expect(status('1. alfa beta gama delta', '2. zeta eta theta iota').sort()).toEqual([
      'adicionada',
      'removida',
    ]);
  });

  it('Art. e Cláusula pareiam por chave', () => {
    expect(status('Art. 5º Texto igual', 'Artigo 5 Texto igual')).toEqual(['alterada']);
    expect(status('Cláusula Primeira Texto', 'CLÁUSULA PRIMEIRA Texto')).toEqual(['alterada']);
  });

  it('sem cláusulas: lista vazia e contagens zeradas', () => {
    const r = diffClauses([page('texto')], [page('outro texto')]);
    expect(r.clauses).toEqual([]);
    expect(r.countA + r.countB).toBe(0);
  });

  it('estatísticas somam as linhas', () => {
    const r = diffClauses([page('1. A\nx\n2. B\ny')], [page('1. A\nx\n2. B\nz')]);
    expect(Object.values(r.stats).reduce((x, y) => x + y, 0)).toBe(r.clauses.length);
  });

  it('ordem de leitura segue B, com removidas no lugar de A', () => {
    const r = diffClauses([page('1. A um\n2. B dois\n3. C três')], [page('1. A um\n3. C três')]);
    expect(r.clauses.map((c) => c.keyA ?? c.keyB)).toEqual(['1', '2', '3']);
  });

  it('reporta chaves duplicadas por lado', () => {
    const r = diffClauses([page('1. A\n1. B')], [page('1. A')]);
    expect(r.duplicateKeysA).toEqual(['1']);
    expect(r.duplicateKeysB).toEqual([]);
  });
});
