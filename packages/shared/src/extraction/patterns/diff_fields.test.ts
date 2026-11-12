import { describe, expect, it } from 'vitest';
import { diffFields, PATTERN_ID } from './diff_fields';

const page = (text: string, pageNumber = 1) => ({ pageNumber, text });
const CPF1 = '111.444.777-35';
const CPF2 = '529.982.247-25';

describe(PATTERN_ID, () => {
  it('mesmo valor nos dois lados: igual, com origem de A e de B', () => {
    const rows = diffFields(
      [page(`Contratante CPF ${CPF1} assina.`, 1)],
      [page(`Intro\n\nContratante CPF ${CPF1} assina.`, 3)],
    );
    const r = rows.find((x) => x.fieldType === 'cpf');
    expect(r?.status).toBe('igual');
    expect(r?.a?.sources[0]?.pageNumber).toBe(1);
    expect(r?.b?.sources[0]?.pageNumber).toBe(3);
    expect(r?.a?.sources[0]?.context.match).toBe(CPF1);
  });

  it('data com o mesmo rótulo e valor diferente: alterado (A → B)', () => {
    const rows = diffFields([page('Vencimento: 10/05/2026')], [page('Vencimento: 15/06/2026')]);
    const r = rows.find((x) => x.fieldType === 'date');
    expect(r?.status).toBe('alterado');
    expect(r?.label).toBe('vencimento');
    expect(r?.a?.normalized).toBe('2026-05-10');
    expect(r?.b?.normalized).toBe('2026-06-15');
  });

  it('sem rótulo não se afirma "alterado": vira somente A + somente B', () => {
    const rows = diffFields([page(`CPF ${CPF1}`)], [page(`CPF ${CPF2}`)]);
    const cpf = rows.filter((x) => x.fieldType === 'cpf').map((x) => x.status);
    expect(cpf.sort()).toEqual(['somente_a', 'somente_b']);
  });

  it('valor que só existe em A', () => {
    const rows = diffFields([page(`CPF ${CPF1} e CPF ${CPF2}`)], [page(`CPF ${CPF1}`)]);
    expect(rows.find((x) => x.a?.normalized === '52998224725')?.status).toBe('somente_a');
    expect(rows.find((x) => x.a?.normalized === '11144477735')?.status).toBe('igual');
  });

  it('valor que só existe em B tem a === null', () => {
    const rows = diffFields([page('sem nada')], [page(`CPF ${CPF1}`)]);
    const r = rows.find((x) => x.fieldType === 'cpf');
    expect(r?.status).toBe('somente_b');
    expect(r?.a).toBeNull();
  });

  it('valores em dinheiro com rótulo: alterado', () => {
    const rows = diffFields([page('Valor total: R$ 1.000,00')], [page('Valor total: R$ 1.250,00')]);
    const r = rows.find((x) => x.fieldType === 'money');
    expect(r?.status).toBe('alterado');
    expect(r?.a?.normalized).toBe('1000.00 BRL');
    expect(r?.b?.normalized).toBe('1250.00 BRL');
  });

  it('limita as origens e conta as ocorrências', () => {
    const text = Array.from({ length: 6 }, (_, i) => `linha ${i} CPF ${CPF1}`).join('\n');
    const r = diffFields([page(text)], [page(text)]).find((x) => x.fieldType === 'cpf');
    expect(r?.a?.occurrences).toBe(6);
    expect(r?.a?.sources).toHaveLength(3);
  });

  it('dois textos sem campos: lista vazia', () => {
    expect(diffFields([page('nada aqui')], [page('nem aqui')])).toEqual([]);
  });

  it('resultado determinístico (ordem estável)', () => {
    const a = [page(`CPF ${CPF2} CPF ${CPF1}`)];
    const b = [page(`CPF ${CPF1}`)];
    expect(JSON.stringify(diffFields(a, b))).toBe(JSON.stringify(diffFields(a, b)));
  });

  it('CPF inválido não é campo (a regra da Fase 3 vale aqui também)', () => {
    expect(diffFields([page('CPF 111.444.777-36')], [page('CPF 111.444.777-36')])).toEqual([]);
  });
});
