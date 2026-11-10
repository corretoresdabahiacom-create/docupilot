import { describe, expect, it } from 'vitest';
import { annexKey, annexKeyFromFileName, findAnnexMentions } from './annex';

describe('annexKey', () => {
  it.each([
    ['I', '1'],
    ['II', '2'],
    ['III', '3'],
    ['IV', '4'],
    ['IX', '9'],
    ['X', '10'],
    ['02', '2'],
    ['7', '7'],
    ['A', 'a'],
  ])('%s → %s', (t, k) => expect(annexKey(t)).toBe(k));
  it.each(['IIII', 'VV', 'abc', '123', '', 'IXI'])('rejeita %s', (t) =>
    expect(annexKey(t)).toBeNull(),
  );
});

describe('findAnnexMentions', () => {
  it.each([
    ['conforme o Anexo I deste contrato', '1'],
    ['ver ANEXO II', '2'],
    ['Anexo 3 - Planilha', '3'],
    ['Anexo nº 4', '4'],
    ['Anexo A', 'a'],
    ['(Anexo III)', '3'],
  ])('acha em "%s"', (t, key) => {
    const m = findAnnexMentions(t);
    expect(m).toHaveLength(1);
    expect(m[0]!.key).toBe(key);
    expect(t.slice(m[0]!.start, m[0]!.end)).toBe(m[0]!.raw);
  });

  it.each([
    'segue em anexo o documento',
    'anexos diversos',
    'Anexos I e II',
    'Anexo',
    'Anexo ilustrativo',
    'Anexo IIII',
  ])('ignora "%s"', (t) => expect(findAnnexMentions(t)).toEqual([]));
});

describe('annexKeyFromFileName', () => {
  it.each([
    ['Anexo I - Planilha.pdf', '1'],
    ['anexo_02_precos.docx', '2'],
    ['ANEXO III.pdf', '3'],
    ['Contrato Anexo 4.pdf', '4'],
    ['Anexo A.txt', 'a'],
    ['Anexo nº 5.pdf', '5'],
  ])('%s → %s', (n, k) => expect(annexKeyFromFileName(n)).toBe(k));
  it.each(['Contrato.pdf', 'anexos.pdf', 'Anexo.pdf', 'relatorio-final.docx'])('%s → null', (n) =>
    expect(annexKeyFromFileName(n)).toBeNull(),
  );
});
