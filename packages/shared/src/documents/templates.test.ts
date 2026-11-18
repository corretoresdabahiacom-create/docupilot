import { describe, expect, it } from 'vitest';
import { docToText } from './export';
import { validateDoc } from './doc';
import {
  applyValues,
  findPlaceholders,
  getTemplate,
  TEMPLATE_KEYS,
  TEMPLATES,
  templateDoc,
} from './templates';

describe('modelos predefinidos', () => {
  it('são exatamente os dez do briefing', () => {
    expect(TEMPLATES.map((t) => t.key).sort()).toEqual([...TEMPLATE_KEYS].sort());
    expect([...TEMPLATE_KEYS].sort()).toEqual([
      'ata',
      'carta',
      'checklist',
      'comunicado',
      'declaracao',
      'formulario',
      'orcamento',
      'proposta',
      'recibo',
      'relatorio',
    ]);
  });
  it.each(TEMPLATES.map((t) => [t.key, t] as const))(
    '%s: válido para o editor e avisa que não é jurídico',
    (_k, tpl) => {
      expect(validateDoc(tpl.doc).ok).toBe(true);
      expect(docToText(tpl.doc)).toMatch(/sem validação jurídica/);
      expect(tpl.name.pt && tpl.name.en && tpl.description.pt && tpl.description.en).toBeTruthy();
    },
  );
  it.each(TEMPLATES.map((t) => [t.key, t] as const))(
    '%s: todo {{campo}} do texto está declarado em fields',
    (_k, tpl) => {
      const declared = tpl.fields.map((f) => f.key);
      for (const key of findPlaceholders(tpl.doc)) expect(declared).toContain(key);
      for (const f of tpl.fields) expect(findPlaceholders(tpl.doc)).toContain(f.key);
    },
  );
});

describe('applyValues', () => {
  const tpl = getTemplate('recibo')!;
  it('preenche o que foi digitado e mantém {{chave}} no que não foi', () => {
    const d = applyValues(tpl.doc, { pagador: 'Ana', valor: 'R$ 100,00' });
    const text = docToText(d);
    expect(text).toContain('Recebi de Ana o valor de R$ 100,00');
    expect(findPlaceholders(d).sort()).toEqual(['data', 'recebedor', 'referente']);
    expect(text).toContain('{{referente}}');
  });
  it('não altera o modelo original', () => {
    const before = JSON.stringify(tpl.doc);
    applyValues(tpl.doc, { pagador: 'X' });
    expect(JSON.stringify(tpl.doc)).toBe(before);
  });
  it('valor vazio, em branco ou só controles não conta como preenchido', () => {
    const d = applyValues(tpl.doc, { pagador: '', recebedor: '   ', valor: '\u0000\u0001' });
    expect(findPlaceholders(d)).toContain('pagador');
    expect(findPlaceholders(d)).toContain('recebedor');
    expect(findPlaceholders(d)).toContain('valor');
  });
  it('valor com {{outra}} ou HTML é tratado como texto simples', () => {
    const d = applyValues(tpl.doc, { pagador: '<b>{{x}}</b>' });
    expect(docToText(d)).toContain('<b>{{x}}</b>');
  });
  it('limita o valor a 500 caracteres', () => {
    const d = applyValues(tpl.doc, { pagador: 'x'.repeat(900) });
    expect(docToText(d)).toContain(`Recebi de ${'x'.repeat(500)} o valor`);
  });
  it('templateDoc: chave inexistente → null', () => {
    expect(templateDoc('nao-existe')).toBeNull();
    expect(templateDoc('carta', { cidade: 'Salvador' })).not.toBeNull();
  });
});
