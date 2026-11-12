import { describe, expect, it } from 'vitest';
import {
  describeField,
  describeFields,
  MAX_FORM_FIELDS,
  normalizeSegment,
  nameSegments,
  PATTERN_ID,
  type RawFormField,
} from './acroform_field';

const raw = (over: Partial<RawFormField>): RawFormField => ({
  name: 'campo',
  pdfType: 'text',
  ...over,
});

describe(`${PATTERN_ID} — reconhece`, () => {
  it('campo de texto simples', () => {
    const f = describeField(raw({ name: 'CPF', maxLength: 14 }));
    expect(f).toMatchObject({ kind: 'text', leaf: 'cpf', maxLength: 14, unsupportedReason: null });
  });
  it('caixa de seleção', () => {
    expect(describeField(raw({ pdfType: 'checkbox' })).kind).toBe('checkbox');
  });
  it('lista suspensa, grupo de opções e lista viram "choice" com opções', () => {
    for (const pdfType of ['dropdown', 'radio', 'list'] as const) {
      const f = describeField(raw({ pdfType, options: ['A', '', 'B'] }));
      expect(f.kind).toBe('choice');
      expect(f.options).toEqual(['A', 'B']);
    }
  });
  it('nome hierárquico separa pai e folha, sem índices', () => {
    const f = describeField(raw({ name: 'form1[0].Cônjuge[0].CPF[0]' }));
    expect(f.leaf).toBe('cpf');
    expect(f.parents).toEqual(['form1', 'conjuge']);
  });
  it('valor existente conta como preenchido; "Off" e vazio não', () => {
    expect(describeField(raw({ value: '123' })).filled).toBe(true);
    expect(describeField(raw({ pdfType: 'checkbox', value: true })).filled).toBe(true);
    expect(describeField(raw({ value: ['', 'x'] })).filled).toBe(true);
    expect(describeField(raw({ value: 'Off' })).filled).toBe(false);
    expect(describeField(raw({ value: '  ' })).filled).toBe(false);
    expect(describeField(raw({ value: null })).filled).toBe(false);
  });
  it('mantém obrigatório e multilinha', () => {
    const f = describeField(raw({ required: true, multiline: true }));
    expect(f).toMatchObject({ required: true, multiline: true });
  });
});

describe(`${PATTERN_ID} — não preenchíveis`, () => {
  it.each([
    ['signature', 'signature'],
    ['button', 'button'],
    ['unknown', 'unknown'],
  ] as const)('%s → não suportado', (pdfType, reason) => {
    expect(describeField(raw({ pdfType }))).toMatchObject({
      kind: 'unsupported',
      unsupportedReason: reason,
    });
  });
  it('somente leitura não é preenchível', () => {
    expect(describeField(raw({ readOnly: true }))).toMatchObject({
      kind: 'unsupported',
      unsupportedReason: 'read_only',
    });
  });
  it('maxLength 0 ou negativo é ignorado', () => {
    expect(describeField(raw({ maxLength: 0 })).maxLength).toBeNull();
    expect(describeField(raw({ maxLength: -3 })).maxLength).toBeNull();
  });
  it('limita a quantidade de campos lidos', () => {
    const many = Array.from({ length: MAX_FORM_FIELDS + 20 }, (_, i) => raw({ name: `c${i}` }));
    expect(describeFields(many)).toHaveLength(MAX_FORM_FIELDS);
  });
  it('lista vazia: nenhum campo', () => {
    expect(describeFields([])).toEqual([]);
  });
});

describe('normalização de nomes', () => {
  it.each([
    ['Data de Nascimento', 'data_de_nascimento'],
    ['E-mail', 'e_mail'],
    ['CPF[0]', 'cpf'],
    ['  Nº Endereço ', 'n_endereco'],
    ['Órgão__Emissor', 'orgao_emissor'],
  ])('%s → %s', (input, out) => {
    expect(normalizeSegment(input)).toBe(out);
  });
  it('segmentos vazios são descartados', () => {
    expect(nameSegments('a..b.')).toEqual(['a', 'b']);
  });
});
