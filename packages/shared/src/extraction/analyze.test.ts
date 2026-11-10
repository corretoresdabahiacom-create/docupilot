import { describe, expect, it } from 'vitest';
import {
  analyzePages,
  extractAll,
  FIELD_PATTERNS,
  findCandidates,
  verifyCandidate,
  verifyField,
  type SubmittedField,
} from './analyze';

const TEXT = [
  'CONTRATO DE PRESTAÇÃO DE SERVIÇOS entre as partes, conforme o que foi acordado, para a execução dos serviços.',
  'Contratante: Empresa X, CNPJ 11.222.333/0001-81, e-mail financeiro@empresax.com.br, fone (71) 3456-7890.',
  'Responsável: CPF 123.456.789-09. Endereço: Rua das Flores, 123 - Centro, CEP 40020-000.',
  'Vencimento: 10/12/2026. Total: R$ 1.234,56 (um mil duzentos e trinta e quatro reais e cinquenta e seis centavos).',
].join('\n');

describe('extractAll', () => {
  const fields = extractAll(TEXT, 'd1', 1, { language: 'pt' });
  const by = (id: string) => fields.filter((f) => f.pattern_id === id);

  it('acha cada tipo esperado, com a origem e confiança do padrão', () => {
    expect(by('cnpj_strict')[0]).toMatchObject({
      normalized_value: '11222333000181',
      confidence: 1,
    });
    expect(by('cpf_strict')[0]).toMatchObject({ normalized_value: '12345678909' });
    expect(by('email_strict')[0]!.normalized_value).toBe('financeiro@empresax.com.br');
    expect(by('phone_br_landline')[0]!.normalized_value).toBe('+55 71 3456-7890');
    expect(by('cep_strict')[0]).toMatchObject({ normalized_value: '40020000', confidence: 1 });
    expect(by('date_br_numeric')[0]).toMatchObject({
      normalized_value: '2026-12-10',
      label: 'vencimento',
    });
    expect(by('currency_brl')[0]).toMatchObject({
      normalized_value: '1234.56 BRL',
      label: 'total',
    });
    expect(by('address_br_heuristic')).toHaveLength(1);
  });

  it('todo campo tem span que reproduz o raw_value', () => {
    for (const f of fields)
      expect(TEXT.slice(f.text_span_start, f.text_span_end)).toBe(f.raw_value);
  });

  it('todos os pattern_id produzidos existem no registro', () => {
    for (const f of fields) expect(FIELD_PATTERNS[f.pattern_id]).toBeDefined();
  });

  it('em sobreposição prevalece a maior confiança (telefone dentro de CPF não duplica)', () => {
    // 11900000083 é um CPF válido e também tem forma de celular (DDD 11 + 90000-0083)
    const f = extractAll('CPF 11900000083 fim', 'd', 1);
    expect(f.map((x) => x.pattern_id)).toEqual(['cpf_strict']);
  });

  it('texto sem nada extraível devolve lista vazia', () => {
    expect(extractAll('Apenas um texto comum sem dados estruturados.', 'd', 1)).toEqual([]);
  });
});

describe('verifyField (reconferência do servidor)', () => {
  const draft = analyzePages([{ pageNumber: 1, text: TEXT }], 'd1');
  const sub = (id: string) => draft.fields.find((f) => f.pattern_id === id)!;

  it('aceita o que o padrão produz e regenera os metadados', () => {
    const v = verifyField(sub('cpf_strict'), TEXT, 'd1', 'pt');
    expect(v).toMatchObject({
      normalized_value: '12345678909',
      confidence: 1,
      source_kind: 'deterministic',
    });
  });

  it('mantém o rótulo (datas e valores)', () => {
    expect(verifyField(sub('date_br_numeric'), TEXT, 'd1', 'pt')!.label).toBe('vencimento');
    expect(verifyField(sub('currency_brl'), TEXT, 'd1', 'pt')!.label).toBe('total');
  });

  it('todo campo gerado pelo analisador passa na reconferência', () => {
    for (const f of draft.fields) {
      expect(verifyField(f, TEXT, 'd1', draft.language), f.pattern_id).not.toBeNull();
    }
  });

  const tamper = (patch: Partial<SubmittedField>): SubmittedField => ({
    ...sub('cpf_strict'),
    ...patch,
  });

  it.each([
    ['raw_value forjado', { raw_value: '123.456.789-10' }],
    ['span deslocado', { span_start: 5 }],
    ['span fora do texto', { span_end: 999_999 }],
    ['span invertido', { span_end: 0 }],
    ['pattern_id inexistente', { pattern_id: 'inventado' }],
    ['pattern_id trocado', { pattern_id: 'cnpj_strict' }],
    ['span não inteiro', { span_start: 1.5 }],
    ['raw_value gigante', { raw_value: 'x'.repeat(500) }],
  ])('rejeita %s', (_name, patch) => {
    expect(verifyField(tamper(patch as Partial<SubmittedField>), TEXT, 'd1', 'pt')).toBeNull();
  });

  it('rejeita CPF com DV inválido mesmo que o span confira', () => {
    const text = 'CPF 123.456.789-10';
    const s: SubmittedField = {
      pattern_id: 'cpf_strict',
      page_number: 1,
      span_start: 4,
      span_end: 18,
      raw_value: '123.456.789-10',
    };
    expect(text.slice(4, 18)).toBe(s.raw_value);
    expect(verifyField(s, text, 'd1', 'pt')).toBeNull();
  });

  it('o idioma muda o resultado de datas ambíguas (e a confiança vem do servidor)', () => {
    const text = 'Due 01/02/2024 ok';
    const s: SubmittedField = {
      pattern_id: 'date_us_numeric',
      page_number: 1,
      span_start: 4,
      span_end: 14,
      raw_value: '01/02/2024',
    };
    expect(verifyField(s, text, 'd', 'en')!.normalized_value).toBe('2024-01-02');
    expect(verifyField(s, text, 'd', 'pt')).toBeNull();
  });

  it('reconfere campos no início e no fim da página (janela cortada)', () => {
    const text = '123.456.789-09';
    const s: SubmittedField = {
      pattern_id: 'cpf_strict',
      page_number: 1,
      span_start: 0,
      span_end: 14,
      raw_value: text,
    };
    expect(verifyField(s, text, 'd', 'pt')).not.toBeNull();
  });
});

describe('analyzePages', () => {
  it('detecta idioma, gera simhash só com texto suficiente e respeita limites', () => {
    const long =
      TEXT + '\n' + Array(60).fill('as partes acordam sobre o cumprimento do contrato').join(' ');
    const d = analyzePages([{ pageNumber: 1, text: long }], 'd1');
    expect(d.language).toBe('pt');
    expect(d.simhash).toMatch(/^[0-9a-f]{16}$/);
    expect(analyzePages([{ pageNumber: 1, text: 'R$ 10,00' }], 'd1').simhash).toBeNull();
  });

  it('corta ocorrências além do limite e informa quantas', () => {
    const text = Array.from({ length: 450 }, (_, i) => `Valor R$ ${i + 1},00`).join('\n');
    const d = analyzePages([{ pageNumber: 1, text }], 'd1');
    expect(d.fields).toHaveLength(400);
    expect(d.truncatedFields).toBe(50);
  });
});

describe('candidatos de inconsistência', () => {
  const text = 'CPF: 123.456.789-10 e CNPJ: 11.222.333/0001-82. Veja o Anexo II e o ANEXO 3.';
  const c = findCandidates(text, 2);

  it('acha DV inválido e menções a anexo', () => {
    expect(c.map((x) => x.rule).sort()).toEqual([
      'annex_mention',
      'annex_mention',
      'invalid_cnpj',
      'invalid_cpf',
    ]);
    expect(
      c
        .filter((x) => x.rule === 'annex_mention')
        .map((x) => x.key)
        .sort(),
    ).toEqual(['2', '3']);
  });

  it('o servidor confirma os verdadeiros e rejeita os forjados', () => {
    for (const x of c) expect(verifyCandidate(x, text).ok).toBe(true);
    const cpf = c.find((x) => x.rule === 'invalid_cpf')!;
    expect(verifyCandidate({ ...cpf, rule: 'invalid_cnpj' }, text).ok).toBe(false);
    expect(verifyCandidate({ ...cpf, raw: '123.456.789-09' }, text).ok).toBe(false);
    expect(verifyCandidate({ ...cpf, end: 9999 }, text).ok).toBe(false);
  });

  it('CPF válido não vira candidato', () => {
    expect(findCandidates('CPF: 123.456.789-09', 1)).toEqual([]);
  });
});
