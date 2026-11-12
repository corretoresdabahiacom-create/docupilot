// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  confirmItem,
  confirmSuggested,
  describeFields,
  proposeFill,
  setManual,
  sourcesFromProfile,
  summarizeFill,
  toWrite,
} from '@docupilot/shared';
import { fillPdf, readFormFields } from './form';

const NOW = new Date('2026-11-12T12:00:00Z');

async function makeForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  const form = doc.getForm();
  const text = (name: string, y: number, opts: { maxLength?: number } = {}) => {
    const f = form.createTextField(name);
    if (opts.maxLength) f.setMaxLength(opts.maxLength);
    f.addToPage(page, { x: 20, y, width: 200, height: 20 });
    return f;
  };
  text('CPF', 560);
  text('Data de Nascimento', 530);
  text('Observações', 500);
  text('Cônjuge.CPF', 470);
  text('Nome Completo', 440, { maxLength: 10 }); // curto de propósito
  const uf = form.createDropdown('UF');
  uf.addOptions(['BA', 'SP']);
  uf.addToPage(page, { x: 20, y: 410, width: 60, height: 20 });
  const box = form.createCheckBox('Aceito os termos');
  box.addToPage(page, { x: 20, y: 380, width: 15, height: 15 });
  return doc.save();
}

const profile = sourcesFromProfile(
  { cpf: '11144477735', birth_date: '1990-03-05', full_name: 'Ana Maria da Silva', state: 'BA' },
  'Meu perfil',
);

describe('readFormFields', () => {
  it('lê nome, tipo, opções e tamanho máximo dos campos', async () => {
    const r = await readFormFields(await makeForm());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hasXfa).toBe(false);
    const by = Object.fromEntries(r.fields.map((f) => [f.name, f]));
    expect(by['CPF']?.pdfType).toBe('text');
    expect(by['Nome Completo']?.maxLength).toBe(10);
    expect(by['UF']).toMatchObject({ pdfType: 'dropdown', options: ['BA', 'SP'] });
    expect(by['Aceito os termos']?.pdfType).toBe('checkbox');
  });

  it('arquivo que não é PDF é "invalid"; PDF sem campos devolve lista vazia', async () => {
    expect(await readFormFields(new TextEncoder().encode('isso não é um pdf'))).toEqual({
      ok: false,
      reason: 'invalid',
    });
    const empty = await PDFDocument.create();
    empty.addPage();
    const r = await readFormFields(await empty.save());
    expect(r).toEqual({ ok: true, fields: [], hasXfa: false });
  });
});

describe('preenchimento de ponta a ponta', () => {
  it('campo ausente fica em branco; confirmado entra; nada entra antes de confirmar', async () => {
    const original = await makeForm();
    const read = await readFormFields(original);
    if (!read.ok) throw new Error('leitura falhou');
    const items = proposeFill(describeFields(read.fields), profile, NOW);
    const by = (name: string) => items.find((i) => i.field.name === name)!;

    // O que o motor propõe, sem inventar:
    expect(by('CPF').state).toBe('mapeado_automaticamente');
    expect(by('Data de Nascimento').state).toBe('mapeado_automaticamente');
    expect(by('UF').state).toBe('mapeado_automaticamente');
    expect(by('Observações').state).toBe('campo_ausente'); // sem origem → em branco
    expect(by('Cônjuge.CPF')).toMatchObject({ state: 'campo_ausente', reason: 'other_person' });
    expect(by('Nome Completo').state).toBe('campo_invalido'); // não cabe em 10 caracteres
    expect(by('Aceito os termos').state).toBe('campo_ausente'); // caixa nunca sozinha
    expect(toWrite(items)).toEqual([]);

    // Sem confirmar, o PDF sai idêntico em conteúdo de campos.
    const untouched = await fillPdf(original, toWrite(items));
    expect(untouched.written).toEqual([]);

    // Confirmação explícita em lote + correção manual do nome.
    let confirmed = confirmSuggested(items, NOW);
    confirmed = confirmed.map((i) =>
      i.field.name === 'Nome Completo' ? setManual(i, 'Ana Maria', NOW) : i,
    );
    const out = await fillPdf(original, toWrite(confirmed));
    expect(out.failed).toEqual([]);
    expect(out.written.sort()).toEqual(['CPF', 'Data de Nascimento', 'Nome Completo', 'UF']);

    // Reabre o PDF gerado e confere campo a campo.
    const again = await readFormFields(out.bytes);
    if (!again.ok) throw new Error('releitura falhou');
    const val = Object.fromEntries(again.fields.map((f) => [f.name, f.value]));
    expect(val['CPF']).toBe('111.444.777-35');
    expect(val['Data de Nascimento']).toBe('05/03/1990');
    expect(val['Nome Completo']).toBe('Ana Maria');
    expect(val['UF']).toEqual(['BA']);
    expect(val['Observações'] ?? '').toBe(''); // campo ausente permaneceu vazio
    expect(val['Cônjuge.CPF'] ?? '').toBe(''); // campo de outra pessoa permaneceu vazio
    expect(val['Aceito os termos']).toBe(false);

    const sum = summarizeFill(confirmed);
    expect(sum.blank).toBe(3); // Observações, Cônjuge.CPF e a caixa de seleção
    expect(sum.confirmed).toBe(4);
  });

  it('o PDF continua editável (não é achatado) e o original não é alterado', async () => {
    const original = await makeForm();
    const copy = original.slice();
    const read = await readFormFields(original);
    if (!read.ok) throw new Error();
    const items = confirmSuggested(proposeFill(describeFields(read.fields), profile, NOW), NOW);
    const out = await fillPdf(original, toWrite(items));
    expect(Array.from(original)).toEqual(Array.from(copy));
    const again = await readFormFields(out.bytes);
    expect(again.ok && again.fields.length).toBe(read.fields.length);
  });

  it('valor que a fonte não codifica é relatado como falha e o campo não é escrito pela metade', async () => {
    const original = await makeForm();
    const out = await fillPdf(original, [
      { name: 'CPF', value: '日本語' },
      { name: 'Observações', value: 'ok' },
    ]);
    expect(out.failed.map((f) => f.name)).toEqual(['CPF']);
    expect(out.written).toEqual(['Observações']);
    const again = await readFormFields(out.bytes);
    if (!again.ok) throw new Error();
    expect(again.fields.find((f) => f.name === 'CPF')?.value ?? '').toBe('');
  });

  it('campo inexistente vira falha, não exceção', async () => {
    const out = await fillPdf(await makeForm(), [{ name: 'não existe', value: 'x' }]);
    expect(out.failed).toHaveLength(1);
    expect(out.written).toEqual([]);
  });

  it('caixa de seleção confirmada manualmente é marcada', async () => {
    const original = await makeForm();
    const read = await readFormFields(original);
    if (!read.ok) throw new Error();
    const items = proposeFill(describeFields(read.fields), profile, NOW).map((i) =>
      i.field.name === 'Aceito os termos' ? setManual(i, true, NOW) : i,
    );
    const out = await fillPdf(original, toWrite(items));
    const again = await readFormFields(out.bytes);
    if (!again.ok) throw new Error();
    expect(again.fields.find((f) => f.name === 'Aceito os termos')?.value).toBe(true);
  });
});

describe('confirmItem isolado', () => {
  it('confirmar um campo sem origem não escreve nada', async () => {
    const read = await readFormFields(await makeForm());
    if (!read.ok) throw new Error();
    const items = proposeFill(describeFields(read.fields), [], NOW).map((i) => confirmItem(i, NOW));
    expect(toWrite(items)).toEqual([]);
  });
});
