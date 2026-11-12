import { describe, expect, it } from 'vitest';
import { nameSegments, type FormField } from './acroform_field';
import {
  canonicalize,
  CANON_KEYS,
  EQUIVALENCE,
  formatForField,
  isWinAnsiEncodable,
  mapFieldName,
  matchOption,
  parseBirthDate,
  PATTERN_ID,
  validateValue,
} from './acroform_type_mapping';

const m = (name: string) => {
  const segs = nameSegments(name);
  return mapFieldName({ leaf: segs.at(-1) ?? '', parents: segs.slice(0, -1) });
};
type FieldShape = Pick<FormField, 'kind' | 'options' | 'maxLength' | 'multiline'>;
const NOW = new Date('2026-11-12T12:00:00Z');

describe(`${PATTERN_ID} — nome do campo → dado (tabela)`, () => {
  it.each([
    ['CPF', 'cpf'],
    ['Data de Nascimento', 'birth_date'],
    ['birth_date', 'birth_date'],
    ['Nome Completo', 'full_name'],
    ['E-mail', 'email'],
    ['CEP', 'cep'],
    ['UF', 'state'],
    ['Nome da Mãe', 'mother_name'],
    ['Titular.CPF', 'cpf'],
  ])('%s → %s (tabela)', (name, key) => {
    expect(m(name)).toEqual({ kind: 'match', key, via: 'table' });
  });
});

describe(`${PATTERN_ID} — por regex de nome (menor confiança)`, () => {
  it.each([
    ['CPF do Proprietário', 'cpf'],
    ['cpf_1', 'cpf'],
    ['Data nasc (dd/mm/aaaa)', 'birth_date'],
    ['E-mail pessoal', 'email'],
    ['Celular com DDD', 'phone'],
  ])('%s → %s (regex)', (name, key) => {
    expect(m(name)).toEqual({ kind: 'match', key, via: 'regex' });
  });
});

describe(`${PATTERN_ID} — não liga`, () => {
  it.each([
    ['Observações'],
    ['Assinatura'],
    ['Nome Fantasia'],
    ['Local de Nascimento'],
    ['Número'],
    ['Campo 17'],
  ])('%s → nenhum', (name) => {
    expect(m(name)).toEqual({ kind: 'none' });
  });
  it.each([
    ['CPF do Cônjuge'],
    ['Cônjuge.CPF'],
    ['Responsável.Nome'],
    ['E-mail do Responsável'],
    ['Telefone de Emergência'],
    ['CPF da Mãe'],
    ['E-mail para contato'],
    ['Testemunha 1.CPF'],
  ])('%s → pertence a outra pessoa, não liga', (name) => {
    expect(m(name)).toEqual({ kind: 'other_person' });
  });
  it('"Nome da Mãe" continua ligado ao nome da mãe, que é o dado dela', () => {
    expect(m('Nome da Mãe')).toMatchObject({ key: 'mother_name' });
  });
  it('apelidos não se repetem entre dados diferentes', () => {
    const seen = new Map<string, string>();
    for (const k of CANON_KEYS)
      for (const a of EQUIVALENCE[k]) {
        expect(seen.get(a), `${a} em ${k} e ${seen.get(a)}`).toBeUndefined();
        seen.set(a, k);
      }
  });
});

describe('canonicalize', () => {
  it.each([
    ['cpf', '111.444.777-35', '11144477735'],
    ['cnpj', '11.222.333/0001-81', '11222333000181'],
    ['cep', '40.000-000', '40000000'],
    ['phone', '+55 (71) 99999-8888', '71999998888'],
    ['phone', '(71) 3456-7890', '7134567890'],
    ['birth_date', '05/03/1990', '1990-03-05'],
    ['email', ' Ana@Example.COM ', 'ana@example.com'],
    ['state', 'ba', 'BA'],
  ] as const)('%s %s → %s', (key, input, out) => {
    expect(canonicalize(key, input, NOW)).toBe(out);
  });
  it.each([
    ['cpf', '111.444.777-36'],
    ['cpf', '111.111.111-11'],
    ['cnpj', '11.222.333/0001-82'],
    ['cep', '1234'],
    ['phone', '12345'],
    ['birth_date', '31/02/1990'],
    ['birth_date', '05/03/2999'],
    ['birth_date', '05/03/1850'],
    ['email', 'sem-arroba'],
    ['state', 'XX'],
    ['full_name', ''],
    ['full_name', 'x'.repeat(201)],
    ['full_name', 'linha\u0000nula'],
  ] as const)('%s %s → inválido', (key, input) => {
    expect(canonicalize(key, input, NOW)).toBeNull();
  });
});

describe('formatForField', () => {
  it('formata conforme o tamanho do campo', () => {
    expect(formatForField('cpf', '11144477735', 14)).toBe('111.444.777-35');
    expect(formatForField('cpf', '11144477735', 11)).toBe('11144477735');
    expect(formatForField('cpf', '11144477735', null)).toBe('111.444.777-35');
    expect(formatForField('cnpj', '11222333000181', 18)).toBe('11.222.333/0001-81');
    expect(formatForField('cnpj', '11222333000181', 14)).toBe('11222333000181');
    expect(formatForField('cep', '40000000', 9)).toBe('40000-000');
    expect(formatForField('cep', '40000000', 8)).toBe('40000000');
    expect(formatForField('phone', '71999998888', 15)).toBe('(71) 99999-8888');
    expect(formatForField('phone', '7134567890', 20)).toBe('(71) 3456-7890');
    expect(formatForField('phone', '71999998888', 11)).toBe('71999998888');
    expect(formatForField('birth_date', '1990-03-05', 10)).toBe('05/03/1990');
    expect(formatForField('birth_date', '1990-03-05', 8)).toBe('05031990');
    expect(formatForField('full_name', 'Ana', 5)).toBe('Ana');
  });
});

describe('parseBirthDate', () => {
  it.each([
    ['1990-03-05', '1990-03-05'],
    ['05/03/1990', '1990-03-05'],
    ['05-03-1990', '1990-03-05'],
    ['05.03.1990', '1990-03-05'],
    ['05031990', '1990-03-05'],
  ])('%s → %s', (i, o) => expect(parseBirthDate(i, NOW)).toBe(o));
  it.each([['1990-13-01'], ['32/01/1990'], ['ontem'], [''], ['2026-11-13']])('%s → null', (i) =>
    expect(parseBirthDate(i, NOW)).toBeNull(),
  );
});

describe('validateValue', () => {
  const text: FieldShape = { kind: 'text', options: [], maxLength: null, multiline: false };
  it('texto livre válido', () => {
    expect(validateValue(text, null, ' Ana ')).toEqual({ ok: true, value: 'Ana' });
  });
  it('vazio, grande demais e codificação', () => {
    expect(validateValue(text, null, '  ')).toEqual({ ok: false, error: 'empty' });
    expect(validateValue({ ...text, maxLength: 3 }, null, 'Ana Maria')).toEqual({
      ok: false,
      error: 'too_long',
    });
    expect(validateValue(text, null, 'olá 😀')).toEqual({ ok: false, error: 'encoding' });
    expect(validateValue(text, null, 'a\nb')).toEqual({ ok: false, error: 'encoding' });
    expect(validateValue({ ...text, multiline: true }, null, 'a\nb').ok).toBe(true);
  });
  it('formato do dado quando o campo está ligado a um', () => {
    expect(validateValue(text, 'cpf', '111.444.777-35').ok).toBe(true);
    expect(validateValue(text, 'cpf', '111.444.777-36')).toEqual({
      ok: false,
      error: 'invalid_format',
    });
  });
  it('lista: só aceita opção existente (sem acento, sem caixa) e devolve a opção exata', () => {
    const choice: FieldShape = {
      kind: 'choice',
      options: ['Solteiro(a)', 'Casado(a)'],
      maxLength: null,
      multiline: false,
    };
    expect(validateValue(choice, null, 'casado(a)')).toEqual({ ok: true, value: 'Casado(a)' });
    expect(validateValue(choice, null, 'Viúvo')).toEqual({ ok: false, error: 'not_in_options' });
  });
  it('caixa: aceita booleano e palavras claras, recusa o resto', () => {
    const box: FieldShape = { kind: 'checkbox', options: [], maxLength: null, multiline: false };
    expect(validateValue(box, null, true)).toEqual({ ok: true, value: true });
    expect(validateValue(box, null, 'Sim')).toEqual({ ok: true, value: true });
    expect(validateValue(box, null, 'não')).toEqual({ ok: true, value: false });
    expect(validateValue(box, null, 'talvez')).toEqual({ ok: false, error: 'not_boolean' });
  });
});

describe('helpers', () => {
  it('matchOption', () => {
    expect(matchOption(['Bahia', 'São Paulo'], 'sao paulo')).toBe('São Paulo');
    expect(matchOption(['Bahia'], 'Minas')).toBeNull();
  });
  it('isWinAnsiEncodable', () => {
    expect(isWinAnsiEncodable('Ação — “ok” €', false)).toBe(true);
    expect(isWinAnsiEncodable('日本語', false)).toBe(false);
    expect(isWinAnsiEncodable('a\tb', false)).toBe(false);
  });
});
