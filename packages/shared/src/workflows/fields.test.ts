import { describe, expect, it } from 'vitest';
import { compareFieldSets, missingTypes, pickFieldValue, MAX_COMPARE_ITEMS } from './fields';

const f = (fieldType: string, normalizedValue: string, label?: string) => ({
  fieldType,
  normalizedValue,
  label: label ?? null,
});

describe('compareFieldSets', () => {
  it('igual, alterado (mesmo rótulo), só A e só B', () => {
    const r = compareFieldSets(
      [
        f('cpf', '1'),
        f('money', '10.00 BRL', 'total'),
        f('email', 'a@x.com'),
        f('cep', '40000000'),
      ],
      [f('cpf', '1'), f('money', '12.00 BRL', 'total'), f('phone', '71999998888')],
    );
    expect(r).toMatchObject({ equal: 1, changed: 1, onlyA: 2, onlyB: 1 });
    const total = r.items.find((i) => i.type === 'money');
    expect(total).toMatchObject({ status: 'alterado', a: ['10.00 BRL'], b: ['12.00 BRL'] });
  });
  it('sem rótulo, valor diferente NÃO é "alterado": fica de um lado só', () => {
    const r = compareFieldSets([f('cpf', '1')], [f('cpf', '2')]);
    expect(r.changed).toBe(0);
    expect(r).toMatchObject({ onlyA: 1, onlyB: 1 });
  });
  it('rótulo é comparado sem caixa e sem espaços nas pontas', () => {
    const r = compareFieldSets(
      [f('date', '2026-01-01', ' Vencimento ')],
      [f('date', '2026-02-01', 'vencimento')],
    );
    expect(r.changed).toBe(1);
  });
  it('valores em comum entre vários CPFs contam como igual', () => {
    const r = compareFieldSets([f('cpf', '1'), f('cpf', '2')], [f('cpf', '2'), f('cpf', '3')]);
    expect(r).toMatchObject({ equal: 1, onlyA: 1, onlyB: 1 });
  });
  it('listas vazias', () => {
    expect(compareFieldSets([], [])).toEqual({
      equal: 0,
      changed: 0,
      onlyA: 0,
      onlyB: 0,
      items: [],
    });
  });
  it('limita os itens devolvidos', () => {
    const many = Array.from({ length: 200 }, (_, i) => f('date', '2026-01-01', `rotulo${i}`));
    expect(compareFieldSets(many, []).items).toHaveLength(MAX_COMPARE_ITEMS);
  });
});

describe('missingTypes e pickFieldValue', () => {
  it('missingTypes lista só o que falta', () => {
    expect(missingTypes([f('cpf', '1')], ['cpf', 'email'])).toEqual(['email']);
    expect(missingTypes([], [])).toEqual([]);
  });
  it('um único valor distinto é escolhido; zero ou vários, não', () => {
    expect(pickFieldValue([f('cpf', '1'), f('cpf', '1')], { fieldType: 'cpf' })).toEqual({
      value: '1',
    });
    expect(pickFieldValue([], { fieldType: 'cpf' })).toEqual({ value: null, reason: 'missing' });
    expect(pickFieldValue([f('cpf', '1'), f('cpf', '2')], { fieldType: 'cpf' })).toEqual({
      value: null,
      reason: 'ambiguous',
    });
  });
  it('rótulo pedido filtra', () => {
    const fs = [f('money', '1', 'total'), f('money', '2', 'desconto')];
    expect(pickFieldValue(fs, { fieldType: 'money', label: 'Total' })).toEqual({ value: '1' });
    expect(pickFieldValue(fs, { fieldType: 'money', label: 'juros' })).toEqual({
      value: null,
      reason: 'missing',
    });
  });
});
