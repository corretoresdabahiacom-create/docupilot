import { describe, expect, it } from 'vitest';
import { selectForQuery, type QueryableField } from './queries';

const f = (
  fieldType: string,
  normalizedValue: string,
  label: string | null = null,
): QueryableField => ({ fieldType, normalizedValue, label });
const all = [
  f('money', '100.00 BRL', 'valor total'),
  f('money', '10.00 BRL', 'desconto'),
  f('money', '5.00 BRL'),
  f('date', '2026-12-10', 'data de vencimento'),
  f('date', '2026-01-01', 'emissao'),
  f('date', '2026-03-03'),
  f('cpf', '12345678909'),
  f('cnpj', '11222333000181'),
  f('email', 'a@b.com'),
];

describe('consultas predefinidas', () => {
  it('valor total: só valores com rótulo de total', () => {
    expect(selectForQuery('total_value', all).map((x) => x.normalizedValue)).toEqual([
      '100.00 BRL',
    ]);
  });
  it('vencimentos: só datas rotuladas como vencimento/prazo', () => {
    expect(selectForQuery('due_dates', all).map((x) => x.normalizedValue)).toEqual(['2026-12-10']);
  });
  it('CPFs/CNPJs', () => {
    expect(selectForQuery('cpf_cnpj', all)).toHaveLength(2);
  });
  it('datas: todas', () => {
    expect(selectForQuery('dates', all)).toHaveLength(3);
  });
  it('sem correspondência devolve vazio (nunca chuta)', () => {
    expect(selectForQuery('total_value', [f('money', '1.00 BRL')])).toEqual([]);
    expect(selectForQuery('due_dates', [])).toEqual([]);
  });
});
