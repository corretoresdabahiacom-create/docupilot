import { describe, expect, it } from 'vitest';
import { analyzePages } from './analyze';
import { extractAll } from './analyze';
import {
  detectDateConflicts,
  detectEmptyRequiredAcroform,
  detectMoneyConflicts,
  RULES,
} from './inconsistencies';

const fields = (text: string) =>
  extractAll(text, 'd', 1, { language: 'pt' }).map((f) => ({ ...f }));

describe('categorias por regra', () => {
  it('seguem a tabela de docs/heuristics.md §15', () => {
    expect(RULES).toEqual({
      date_conflict_same_label: 'erro_confirmado_por_regra',
      money_conflict_same_label: 'erro_confirmado_por_regra',
      empty_required_acroform: 'erro_confirmado_por_regra',
      missing_annex_reference: 'exige_revisao_humana',
      duplicate_exact: 'erro_confirmado_por_regra',
      duplicate_similar: 'divergencia_identificada',
      cpf_cnpj_dv_invalid: 'erro_confirmado_por_regra',
    });
  });
});

describe('date_conflict_same_label', () => {
  it('2 datas distintas para o mesmo rótulo de valor único', () => {
    const f = detectDateConflicts(
      fields('Vencimento: 10/12/2026\nOutras linhas.\nVencimento: 15/12/2026'),
    );
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({
      ruleId: 'date_conflict_same_label',
      category: 'erro_confirmado_por_regra',
    });
    expect(f[0]!.detail.label).toBe('vencimento');
    expect(f[0]!.evidence).toHaveLength(2);
    expect(f[0]!.evidence[0]).toMatchObject({ pageNumber: 1, raw: '10/12/2026' });
  });

  it.each([
    ['mesma data repetida', 'Vencimento: 10/12/2026\nVencimento: 10/12/2026'],
    [
      'mesma data em formatos distintos',
      'Vencimento: 10/12/2026\nVencimento: 10 de dezembro de 2026',
    ],
    ['rótulo genérico (pode repetir)', 'Data: 10/12/2026\nData: 15/12/2026'],
    ['rótulos diferentes', 'Vencimento: 10/12/2026\nEmissão: 01/12/2026'],
    ['datas sem rótulo', 'em 10/12/2026 e em 15/12/2026'],
  ])('não dispara: %s', (_n, t) => {
    expect(detectDateConflicts(fields(t))).toEqual([]);
  });

  it('formatos diferentes com datas diferentes disparam', () => {
    expect(
      detectDateConflicts(
        fields('Data de emissão: 10/12/2026\nData de emissão: 11 de dezembro de 2026'),
      ),
    ).toHaveLength(1);
  });
});

describe('money_conflict_same_label', () => {
  it('2 valores distintos para "Total"', () => {
    const f = detectMoneyConflicts(fields('Total: R$ 1.000,00\nResumo\nTotal: R$ 1.200,00'));
    expect(f).toHaveLength(1);
    expect(f[0]!.detail.values).toBe('1000.00 BRL | 1200.00 BRL');
  });

  it.each([
    ['mesmo valor', 'Total: R$ 1.000,00\nTotal: R$ 1.000,00'],
    ['valor numérico e por extenso iguais', 'Total: R$ 1.000,00\nTotal: R$ 1.000,00 (mil reais)'],
    ['rótulo genérico', 'Valor: R$ 10,00\nValor: R$ 20,00'],
    ['rótulos distintos', 'Total: R$ 10,00\nSubtotal: R$ 5,00'],
    ['sem rótulo', 'R$ 10,00 e R$ 20,00'],
  ])('não dispara: %s', (_n, t) => {
    expect(detectMoneyConflicts(fields(t))).toEqual([]);
  });

  it('moedas diferentes contam como valores diferentes', () => {
    expect(detectMoneyConflicts(fields('Total: R$ 100,00\nTotal: US$ 100.00'))).toHaveLength(1);
  });
});

describe('empty_required_acroform', () => {
  it('só campos obrigatórios e vazios', () => {
    const f = detectEmptyRequiredAcroform([
      { pageNumber: 1, name: 'nome', required: true, filled: false },
      { pageNumber: 1, name: 'cpf', required: true, filled: true },
      { pageNumber: 2, name: 'obs', required: false, filled: false },
    ]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ ruleId: 'empty_required_acroform', detail: { name: 'nome' } });
  });
  it('lista vazia não gera nada', () => {
    expect(detectEmptyRequiredAcroform([])).toEqual([]);
  });
});

describe('integração com analyzePages', () => {
  it('não depende do texto bruto para as regras de conflito', () => {
    const d = analyzePages([{ pageNumber: 1, text: 'Total: R$ 1,00\nTotal: R$ 2,00' }], 'd');
    expect(d.fields.length).toBe(2);
  });
});
