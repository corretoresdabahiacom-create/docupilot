import { describe, expect, it } from 'vitest';
import { clauseKey, PATTERN_ID, splitClauses } from './clause_boundary';

describe(`${PATTERN_ID} — clauseKey (reconhece)`, () => {
  it.each([
    ['1. Do objeto', '1'],
    ['1.1. O contratado deve', '1.1'],
    ['2.3.4 Disposições', '2.3.4'],
    ['Art. 5º Fica', 'art 5'],
    ['Artigo 12 - Das multas', 'art 12'],
    ['CLÁUSULA PRIMEIRA – Do Objeto', 'clausula primeira'],
    ['Cláusula 3ª - Preço', 'clausula 3'],
    ['Cláusula Décima Segunda', 'clausula decima segunda'],
    ['Cláusula única', 'clausula unica'],
  ])('%s → %s', (line, key) => {
    expect(clauseKey(line)).toBe(key);
  });
});

describe(`${PATTERN_ID} — clauseKey (não reconhece)`, () => {
  it.each([
    ['1.000,00 reais pelo serviço'],
    ['10.05.2024 data de assinatura'],
    ['2024 foi o ano'],
    ['3 pessoas compareceram'],
    ['Conforme a cláusula de rescisão'],
    ['Cláusula de rescisão do contrato'],
    ['artefato antigo'],
    ['página 12'],
    ['1.5mil'],
  ])('%s', (line) => {
    expect(clauseKey(line)).toBeNull();
  });
});

describe(`${PATTERN_ID} — splitClauses`, () => {
  it('agrupa linhas seguintes até o próximo cabeçalho e conta o preâmbulo', () => {
    const r = splitClauses([
      {
        pageNumber: 1,
        text: 'CONTRATO\nPartes abaixo\n1. Objeto\nPrestar serviço.\n2. Preço\nR$ 10,00\n',
      },
    ]);
    expect(r.preambleLines).toBe(2);
    expect(r.clauses.map((c) => c.key)).toEqual(['1', '2']);
    expect(r.clauses[0]?.text).toBe('1. Objeto Prestar serviço.');
    expect(r.clauses[0]?.body).toBe('Objeto Prestar serviço.');
  });

  it('cláusula que atravessa páginas guarda a página do cabeçalho', () => {
    const r = splitClauses([
      { pageNumber: 2, text: '1. Objeto\nlinha a' },
      { pageNumber: 3, text: 'linha b\n2. Preço' },
    ]);
    expect(r.clauses[0]?.pageNumber).toBe(2);
    expect(r.clauses[0]?.text).toContain('linha b');
    expect(r.clauses[1]?.pageNumber).toBe(3);
  });

  it('chave repetida recebe sufixo e é reportada', () => {
    const r = splitClauses([{ pageNumber: 1, text: '1. A\n1. B' }]);
    expect(r.clauses.map((c) => c.key)).toEqual(['1', '1#2']);
    expect(r.duplicateKeys).toEqual(['1']);
  });

  it('sem numeração: nenhuma cláusula', () => {
    const r = splitClauses([{ pageNumber: 1, text: 'texto corrido\noutra linha' }]);
    expect(r.clauses).toEqual([]);
    expect(r.preambleLines).toBe(2);
  });

  it('ordena páginas fora de ordem', () => {
    const r = splitClauses([
      { pageNumber: 2, text: '2. B' },
      { pageNumber: 1, text: '1. A' },
    ]);
    expect(r.clauses.map((c) => c.key)).toEqual(['1', '2']);
  });
});
