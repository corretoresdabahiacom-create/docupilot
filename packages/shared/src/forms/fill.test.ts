import { describe, expect, it } from 'vitest';
import { describeField, type RawFormField } from '../extraction/patterns/acroform_field';
import {
  clearItem,
  confirmItem,
  confirmSuggested,
  pickCandidate,
  proposeFill,
  setManual,
  sourcesFromExtracted,
  sourcesFromProfile,
  summarizeFill,
  toWrite,
  type DataSource,
  type FillItem,
} from './fill';

const NOW = new Date('2026-11-12T12:00:00Z');
const f = (name: string, over: Partial<RawFormField> = {}) =>
  describeField({ name, pdfType: 'text', ...over });
const profile = (fields: Record<string, string>): DataSource[] =>
  sourcesFromProfile(fields, 'Meu perfil');
const doc = (key: DataSource['key'], value: string, name = 'rg.pdf', page = 1): DataSource => ({
  key,
  value,
  origin: { kind: 'document', label: name, documentId: name, pageNumber: page },
});
const run = (names: string[], sources: DataSource[]) =>
  proposeFill(
    names.map((n) => f(n)),
    sources,
    NOW,
  );
const byName = (items: FillItem[], name: string) =>
  items.find((i) => i.field.name === name) as FillItem;

describe('proposeFill — estados', () => {
  it('perfil + nome na tabela → mapeado_automaticamente, formatado para o campo', () => {
    const [i] = proposeFill([f('CPF', { maxLength: 14 })], profile({ cpf: '11144477735' }), NOW);
    expect(i).toMatchObject({
      state: 'mapeado_automaticamente',
      value: '111.444.777-35',
      via: 'table',
      key: 'cpf',
    });
    expect(i?.origins[0]).toMatchObject({ kind: 'profile' });
  });

  it('valor só de documento de referência → preenchido_por_regex, com página de origem', () => {
    const [i] = run(['CPF'], [doc('cpf', '11144477735', 'rg.pdf', 3)]);
    expect(i?.state).toBe('preenchido_por_regex');
    expect(i?.origins[0]).toMatchObject({ kind: 'document', pageNumber: 3, label: 'rg.pdf' });
  });

  it('campo sem origem → campo_ausente (nada é inventado)', () => {
    const [i] = run(['CPF'], []);
    expect(i).toMatchObject({ state: 'campo_ausente', reason: 'no_source', value: null });
    expect(i?.origins).toEqual([]);
  });

  it('campo que nenhuma regra entende → campo_ausente "unmapped"', () => {
    const [i] = run(['Observações'], profile({ cpf: '11144477735' }));
    expect(i).toMatchObject({ state: 'campo_ausente', reason: 'unmapped', key: null });
  });

  it('dois valores diferentes → aguardando_confirmacao, sem escolher um', () => {
    const [i] = run(['CPF'], [doc('cpf', '11144477735'), doc('cpf', '52998224725', 'b.pdf')]);
    expect(i).toMatchObject({ state: 'aguardando_confirmacao', reason: 'ambiguous', value: null });
    expect(i?.candidates).toHaveLength(2);
  });

  it('o mesmo valor em perfil e documento é um só candidato, com as duas origens', () => {
    const [i] = run(['CPF'], [...profile({ cpf: '11144477735' }), doc('cpf', '11144477735')]);
    expect(i?.state).toBe('mapeado_automaticamente');
    expect(i?.origins.map((o) => o.kind)).toEqual(['profile', 'document']);
  });

  it('nome só parecido (regex) → aguardando_confirmacao com sugestão', () => {
    const [i] = run(['CPF do Proprietário'], profile({ cpf: '11144477735' }));
    expect(i).toMatchObject({
      state: 'aguardando_confirmacao',
      reason: 'name_heuristic',
      via: 'regex',
      value: '111.444.777-35',
    });
  });

  it('campo de outra pessoa nunca é preenchido', () => {
    const items = run(['Cônjuge.CPF', 'CPF do Responsável'], profile({ cpf: '11144477735' }));
    for (const i of items)
      expect(i).toMatchObject({ state: 'campo_ausente', reason: 'other_person' });
  });

  it('valor que não cabe no campo → campo_invalido', () => {
    const [i] = proposeFill([f('CPF', { maxLength: 5 })], profile({ cpf: '11144477735' }), NOW);
    expect(i).toMatchObject({ state: 'campo_invalido', error: 'too_long' });
  });

  it('lista sem a opção → campo_invalido; com a opção → mapeado', () => {
    const bad = proposeFill(
      [f('UF', { pdfType: 'dropdown', options: ['Bahia'] })],
      profile({ state: 'SP' }),
      NOW,
    );
    expect(bad[0]).toMatchObject({ state: 'campo_invalido', error: 'not_in_options' });
    const ok = proposeFill(
      [f('UF', { pdfType: 'dropdown', options: ['SP', 'BA'] })],
      profile({ state: 'sp' }),
      NOW,
    );
    expect(ok[0]).toMatchObject({ state: 'mapeado_automaticamente', value: 'SP' });
  });

  it('assinatura, botão e somente leitura não são preenchíveis', () => {
    const items = proposeFill(
      [
        f('Assinatura', { pdfType: 'signature' }),
        f('Enviar', { pdfType: 'button' }),
        f('CPF', { readOnly: true }),
      ],
      profile({ cpf: '11144477735' }),
      NOW,
    );
    expect(items.every((i) => !i.fillable && i.reason === 'unsupported')).toBe(true);
  });

  it('caixa de seleção nunca é preenchida sozinha', () => {
    const [i] = proposeFill(
      [f('Aceito', { pdfType: 'checkbox' })],
      profile({ cpf: '11144477735' }),
      NOW,
    );
    expect(i?.state).toBe('campo_ausente');
  });
});

describe('confirmação e correção pela pessoa', () => {
  const sources = profile({ cpf: '11144477735', birth_date: '1990-03-05' });

  it('confirmItem leva o sugerido a confirmado e só ele vai para o PDF', () => {
    const items = run(['CPF', 'Data de Nascimento', 'Observações'], sources);
    expect(toWrite(items)).toEqual([]); // nada vai antes de confirmar
    const confirmed = items.map((i) =>
      i.state === 'mapeado_automaticamente' ? confirmItem(i, NOW) : i,
    );
    expect(toWrite(confirmed)).toEqual([
      { name: 'CPF', value: '111.444.777-35' },
      { name: 'Data de Nascimento', value: '05/03/1990' },
    ]);
  });

  it('confirmSuggested confirma mapeados e por regex, mas não ambíguos, ausentes nem inválidos', () => {
    const items = proposeFill(
      [f('CPF'), f('Data de Nascimento'), f('Observações'), f('Telefone', { maxLength: 3 })],
      [...sources, ...profile({ phone: '71999998888' }), doc('cpf', '52998224725')],
      NOW,
    );
    const after = confirmSuggested(items, NOW);
    expect(byName(after, 'CPF').state).toBe('aguardando_confirmacao'); // dois CPFs
    expect(byName(after, 'Data de Nascimento').state).toBe('confirmado');
    expect(byName(after, 'Observações').state).toBe('campo_ausente');
    expect(byName(after, 'Telefone').state).toBe('campo_invalido');
  });

  it('campo ausente: só entra no PDF depois que a pessoa digita e o valor é válido', () => {
    const [absent] = run(['Observações'], []);
    expect(toWrite([absent as FillItem])).toEqual([]);
    const typed = setManual(absent as FillItem, '  Sem restrições ', NOW);
    expect(typed).toMatchObject({ state: 'confirmado', value: 'Sem restrições' });
    expect(typed.origins).toEqual([{ kind: 'manual', label: 'manual' }]);
    expect(toWrite([typed])).toEqual([{ name: 'Observações', value: 'Sem restrições' }]);
  });

  it('valor digitado inválido fica campo_invalido e não vai para o PDF', () => {
    const [cpf] = run(['CPF'], []);
    const typed = setManual(cpf as FillItem, '111.444.777-36', NOW);
    expect(typed).toMatchObject({ state: 'campo_invalido', error: 'invalid_format' });
    expect(toWrite([typed])).toEqual([]);
    const fixed = setManual(typed, '111.444.777-35', NOW);
    expect(fixed.state).toBe('confirmado');
  });

  it('digitar vazio volta a campo_ausente; clearItem também', () => {
    const [cpf] = run(['CPF'], sources);
    const confirmed = confirmItem(cpf as FillItem, NOW);
    expect(setManual(confirmed, '   ', NOW).state).toBe('campo_ausente');
    expect(clearItem(confirmed)).toMatchObject({
      state: 'campo_ausente',
      value: null,
      origins: [],
    });
  });

  it('caso ambíguo: a pessoa escolhe um candidato e a origem dele é mantida', () => {
    const [cpf] = run(
      ['CPF'],
      [doc('cpf', '11144477735', 'a.pdf', 2), doc('cpf', '52998224725', 'b.pdf', 5)],
    );
    const picked = pickCandidate(cpf as FillItem, 1, NOW);
    expect(picked).toMatchObject({ state: 'confirmado', value: '529.982.247-25' });
    expect(picked.origins[0]).toMatchObject({ label: 'b.pdf', pageNumber: 5 });
    expect(pickCandidate(cpf as FillItem, 9, NOW)).toBe(cpf);
  });

  it('caixa: marcar manualmente confirma true; "talvez" é inválido', () => {
    const [box] = proposeFill([f('Aceito', { pdfType: 'checkbox' })], [], NOW);
    expect(setManual(box as FillItem, true, NOW)).toMatchObject({
      state: 'confirmado',
      value: true,
    });
    expect(setManual(box as FillItem, 'talvez', NOW).state).toBe('campo_invalido');
  });

  it('confirmItem sem valor não inventa nada', () => {
    const [i] = run(['CPF'], []);
    expect(confirmItem(i as FillItem, NOW)).toMatchObject({ state: 'campo_ausente', value: null });
  });

  it('item não preenchível ignora qualquer ação', () => {
    const [sig] = proposeFill([f('Assinatura', { pdfType: 'signature' })], [], NOW);
    expect(setManual(sig as FillItem, 'x', NOW)).toBe(sig);
    expect(clearItem(sig as FillItem)).toBe(sig);
  });
});

describe('invariante: todo valor escrito tem origem', () => {
  it('em qualquer sequência de ações, toWrite só devolve campos com origem', () => {
    const items = proposeFill(
      [
        f('CPF'),
        f('Observações'),
        f('Data de Nascimento'),
        f('Cônjuge.CPF'),
        f('UF', { pdfType: 'dropdown', options: ['BA'] }),
      ],
      profile({ cpf: '11144477735', state: 'BA' }),
      NOW,
    );
    const all = confirmSuggested(items, NOW).map((i) => confirmItem(i, NOW));
    for (const w of toWrite(all)) {
      const item = byName(all, w.name);
      expect(item.origins.length).toBeGreaterThan(0);
    }
    expect(
      toWrite(all)
        .map((w) => w.name)
        .sort(),
    ).toEqual(['CPF', 'UF']);
  });
});

describe('summarizeFill', () => {
  it('conta por estado, em branco, não suportados e obrigatórios faltando', () => {
    const items = proposeFill(
      [
        f('CPF', { required: true }),
        f('Nome Completo', { required: true }),
        f('Observações'),
        f('Assinatura', { pdfType: 'signature' }),
      ],
      profile({ cpf: '11144477735' }),
      NOW,
    );
    const s = summarizeFill(confirmSuggested(items, NOW));
    expect(s.total).toBe(3);
    expect(s.unsupported).toBe(1);
    expect(s.confirmed).toBe(1);
    expect(s.blank).toBe(2);
    expect(s.requiredMissing).toEqual(['Nome Completo']);
    expect(s.counts.campo_ausente).toBe(2);
  });

  it('campo obrigatório que já vem preenchido no PDF não conta como faltando', () => {
    const items = proposeFill([f('Nome Completo', { required: true, value: 'Ana' })], [], NOW);
    expect(summarizeFill(items).requiredMissing).toEqual([]);
  });
});

describe('fontes de dados', () => {
  it('campos extraídos viram fontes canônicas; só datas rotuladas como nascimento', () => {
    const src = sourcesFromExtracted(
      [
        {
          fieldType: 'cpf',
          normalizedValue: '11144477735',
          label: null,
          sources: [{ pageNumber: 2 }],
        },
        {
          fieldType: 'phone',
          normalizedValue: '+55 71 99999-8888',
          label: null,
          sources: [{ pageNumber: 1 }],
        },
        {
          fieldType: 'date',
          normalizedValue: '1990-03-05',
          label: 'data de nascimento',
          sources: [{ pageNumber: 1 }],
        },
        {
          fieldType: 'date',
          normalizedValue: '2026-12-10',
          label: 'vencimento',
          sources: [{ pageNumber: 1 }],
        },
        {
          fieldType: 'money',
          normalizedValue: '10.00 BRL',
          label: 'total',
          sources: [{ pageNumber: 1 }],
        },
        { fieldType: 'cpf', normalizedValue: '111', label: null, sources: [{ pageNumber: 1 }] },
      ],
      { id: 'd1', name: 'rg.pdf' },
      NOW,
    );
    expect(src.map((s) => [s.key, s.value])).toEqual([
      ['cpf', '11144477735'],
      ['phone', '71999998888'],
      ['birth_date', '1990-03-05'],
    ]);
    expect(src[0]?.origin).toMatchObject({ kind: 'document', documentId: 'd1', pageNumber: 2 });
  });

  it('perfil ignora campos vazios', () => {
    expect(sourcesFromProfile({ cpf: '11144477735', city: '' }, 'p')).toHaveLength(1);
  });
});
