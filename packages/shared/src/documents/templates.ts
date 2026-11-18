/**
 * Dez modelos predefinidos (Fase 6, D15). **Nenhum é validado juridicamente**: são pontos de
 * partida de texto, sem parecer legal, contábil ou fiscal. Os campos `{{chave}}` só são
 * preenchidos com o que a pessoa digitar; o que ficar em branco continua visível como `{{chave}}`
 * (nunca inventamos dados). O conteúdo dos modelos está em português do Brasil.
 */
import type { DocNode, DocRoot } from './doc';
import { validateDoc, walk } from './doc';

export const TEMPLATE_KEYS = [
  'proposta',
  'relatorio',
  'orcamento',
  'carta',
  'comunicado',
  'declaracao',
  'ata',
  'formulario',
  'recibo',
  'checklist',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface TemplateField {
  key: string;
  label: { pt: string; en: string };
}
export interface TemplateDef {
  key: TemplateKey;
  name: { pt: string; en: string };
  description: { pt: string; en: string };
  fields: TemplateField[];
  doc: DocRoot;
}

// ---------- construtores ----------
const t = (text: string): DocNode => ({ type: 'text', text });
const p = (text = ''): DocNode =>
  text ? { type: 'paragraph', content: [t(text)] } : { type: 'paragraph' };
const h = (level: 1 | 2 | 3, text: string): DocNode => ({
  type: 'heading',
  attrs: { level },
  content: [t(text)],
});
const ul = (items: string[]): DocNode => ({
  type: 'bulletList',
  content: items.map((i) => ({ type: 'listItem', content: [p(i)] })),
});
const ol = (items: string[]): DocNode => ({
  type: 'orderedList',
  attrs: { start: 1 },
  content: items.map((i) => ({ type: 'listItem', content: [p(i)] })),
});
const table = (head: string[], rows: string[][]): DocNode => ({
  type: 'table',
  content: [
    { type: 'tableRow', content: head.map((c) => ({ type: 'tableHeader', content: [p(c)] })) },
    ...rows.map((r) => ({
      type: 'tableRow',
      content: r.map((c) => ({ type: 'tableCell', content: [p(c)] })),
    })),
  ],
});
const f = (key: string, pt: string, en: string): TemplateField => ({ key, label: { pt, en } });
const doc = (...content: DocNode[]): DocRoot => ({ type: 'doc', content });

const NOTE = 'Modelo de texto sem validação jurídica. Revise e adapte antes de usar.';

export const TEMPLATES: readonly TemplateDef[] = [
  {
    key: 'proposta',
    name: { pt: 'Proposta', en: 'Proposal' },
    description: { pt: 'Proposta comercial simples', en: 'Simple business proposal' },
    fields: [
      f('cliente', 'Cliente', 'Client'),
      f('empresa', 'Sua empresa', 'Your company'),
      f('data', 'Data', 'Date'),
      f('validade', 'Validade da proposta', 'Proposal validity'),
    ],
    doc: doc(
      h(1, 'Proposta para {{cliente}}'),
      p('{{empresa}} · {{data}}'),
      h(2, 'Objetivo'),
      p('Descreva o que será entregue e o problema que a proposta resolve.'),
      h(2, 'Escopo'),
      ul(['Entrega 1', 'Entrega 2', 'Entrega 3']),
      h(2, 'Prazo e investimento'),
      table(
        ['Item', 'Prazo', 'Valor'],
        [
          ['Item 1', '', ''],
          ['Item 2', '', ''],
        ],
      ),
      h(2, 'Condições'),
      p('Validade desta proposta: {{validade}}.'),
      p(NOTE),
    ),
  },
  {
    key: 'relatorio',
    name: { pt: 'Relatório', en: 'Report' },
    description: {
      pt: 'Relatório com resumo, achados e próximos passos',
      en: 'Report with summary, findings and next steps',
    },
    fields: [
      f('titulo', 'Título', 'Title'),
      f('autor', 'Autor', 'Author'),
      f('periodo', 'Período', 'Period'),
    ],
    doc: doc(
      h(1, 'Relatório: {{titulo}}'),
      p('Autor: {{autor}} · Período: {{periodo}}'),
      h(2, 'Resumo'),
      p('Resuma em poucas linhas o que foi feito e o resultado principal.'),
      h(2, 'Achados'),
      ol(['Achado 1', 'Achado 2']),
      h(2, 'Próximos passos'),
      ul(['Ação 1', 'Ação 2']),
      p(NOTE),
    ),
  },
  {
    key: 'orcamento',
    name: { pt: 'Orçamento', en: 'Quote' },
    description: { pt: 'Orçamento com tabela de itens', en: 'Quote with an item table' },
    fields: [
      f('cliente', 'Cliente', 'Client'),
      f('data', 'Data', 'Date'),
      f('total', 'Total', 'Total'),
      f('validade', 'Validade', 'Validity'),
    ],
    doc: doc(
      h(1, 'Orçamento'),
      p('Cliente: {{cliente}} · Data: {{data}}'),
      table(
        ['Descrição', 'Qtd.', 'Valor unitário', 'Subtotal'],
        [
          ['', '', '', ''],
          ['', '', '', ''],
          ['', '', '', ''],
        ],
      ),
      p('Total: {{total}}'),
      p('Validade: {{validade}}.'),
      p(NOTE),
    ),
  },
  {
    key: 'carta',
    name: { pt: 'Carta', en: 'Letter' },
    description: { pt: 'Carta formal', en: 'Formal letter' },
    fields: [
      f('cidade', 'Cidade', 'City'),
      f('data', 'Data', 'Date'),
      f('destinatario', 'Destinatário', 'Recipient'),
      f('remetente', 'Remetente', 'Sender'),
    ],
    doc: doc(
      p('{{cidade}}, {{data}}.'),
      p('A/C {{destinatario}}'),
      p('Prezado(a),'),
      p('Escreva aqui o assunto da carta.'),
      p('Atenciosamente,'),
      p('{{remetente}}'),
      p(NOTE),
    ),
  },
  {
    key: 'comunicado',
    name: { pt: 'Comunicado', en: 'Announcement' },
    description: { pt: 'Comunicado interno ou externo', en: 'Internal or external announcement' },
    fields: [
      f('assunto', 'Assunto', 'Subject'),
      f('data', 'Data', 'Date'),
      f('responsavel', 'Responsável', 'Responsible person'),
    ],
    doc: doc(
      h(1, 'Comunicado: {{assunto}}'),
      p('Data: {{data}}'),
      p('Informamos que…'),
      h(2, 'O que muda'),
      ul(['Ponto 1', 'Ponto 2']),
      p('Dúvidas: falar com {{responsavel}}.'),
      p(NOTE),
    ),
  },
  {
    key: 'declaracao',
    name: { pt: 'Declaração', en: 'Statement' },
    description: {
      pt: 'Declaração simples (sem valor jurídico garantido)',
      en: 'Simple statement (no guaranteed legal value)',
    },
    fields: [
      f('declarante', 'Declarante', 'Declarant'),
      f('documento', 'Documento do declarante', 'Declarant ID'),
      f('cidade', 'Cidade', 'City'),
      f('data', 'Data', 'Date'),
    ],
    doc: doc(
      h(1, 'Declaração'),
      p('Eu, {{declarante}}, documento {{documento}}, declaro que…'),
      p('{{cidade}}, {{data}}.'),
      p('______________________________'),
      p('{{declarante}}'),
      p(`${NOTE} Pode exigir forma, testemunhas ou firma reconhecida conforme o caso.`),
    ),
  },
  {
    key: 'ata',
    name: { pt: 'Ata de reunião', en: 'Meeting minutes' },
    description: {
      pt: 'Ata com pauta, decisões e responsáveis',
      en: 'Minutes with agenda, decisions and owners',
    },
    fields: [
      f('reuniao', 'Reunião', 'Meeting'),
      f('data', 'Data', 'Date'),
      f('participantes', 'Participantes', 'Attendees'),
    ],
    doc: doc(
      h(1, 'Ata: {{reuniao}}'),
      p('Data: {{data}}'),
      p('Participantes: {{participantes}}'),
      h(2, 'Pauta'),
      ol(['Assunto 1', 'Assunto 2']),
      h(2, 'Decisões'),
      table(
        ['Decisão', 'Responsável', 'Prazo'],
        [
          ['', '', ''],
          ['', '', ''],
        ],
      ),
      p(NOTE),
    ),
  },
  {
    key: 'formulario',
    name: { pt: 'Formulário', en: 'Form' },
    description: { pt: 'Formulário em tabela para preencher', en: 'Table-based form to fill in' },
    fields: [f('titulo', 'Título do formulário', 'Form title')],
    doc: doc(
      h(1, '{{titulo}}'),
      table(
        ['Campo', 'Resposta'],
        [
          ['Nome', ''],
          ['Data', ''],
          ['Contato', ''],
          ['Observações', ''],
        ],
      ),
      p(NOTE),
    ),
  },
  {
    key: 'recibo',
    name: { pt: 'Recibo', en: 'Receipt' },
    description: {
      pt: 'Recibo simples (não é documento fiscal)',
      en: 'Simple receipt (not a tax document)',
    },
    fields: [
      f('pagador', 'Pagador', 'Payer'),
      f('recebedor', 'Quem recebeu', 'Payee'),
      f('valor', 'Valor', 'Amount'),
      f('referente', 'Referente a', 'For'),
      f('data', 'Data', 'Date'),
    ],
    doc: doc(
      h(1, 'Recibo'),
      p('Recebi de {{pagador}} o valor de {{valor}}, referente a {{referente}}.'),
      p('Data: {{data}}'),
      p('______________________________'),
      p('{{recebedor}}'),
      p(`${NOTE} Este recibo não substitui nota fiscal nem comprovação tributária.`),
    ),
  },
  {
    key: 'checklist',
    name: { pt: 'Checklist', en: 'Checklist' },
    description: { pt: 'Lista de verificação', en: 'Checklist' },
    fields: [f('titulo', 'Título', 'Title'), f('responsavel', 'Responsável', 'Owner')],
    doc: doc(
      h(1, 'Checklist: {{titulo}}'),
      p('Responsável: {{responsavel}}'),
      ul(['☐ Item 1', '☐ Item 2', '☐ Item 3']),
      p(NOTE),
    ),
  },
];

export const getTemplate = (key: string): TemplateDef | undefined =>
  TEMPLATES.find((x) => x.key === key);

// ---------- campos {{chave}} ----------

const PLACEHOLDER = /\{\{([a-z][a-z0-9_]{0,40})\}\}/g;

/** Chaves `{{...}}` ainda presentes no documento, sem repetição. */
export function findPlaceholders(d: DocRoot): string[] {
  const found = new Set<string>();
  walk(d, (n) => {
    if (n.type !== 'text' || !n.text) return;
    for (const m of n.text.matchAll(PLACEHOLDER)) found.add(m[1] as string);
  });
  return [...found];
}

const cleanValue = (v: string) => {
  let out = '';
  for (const ch of v) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 32 || code === 127 ? ' ' : ch;
  }
  return out.replace(/ {2,}/g, ' ').trim().slice(0, 500);
};

/** Troca `{{chave}}` pelo valor digitado. Chave sem valor continua como está. */
export function applyValues(d: DocRoot, values: Record<string, string | undefined>): DocRoot {
  const copy = JSON.parse(JSON.stringify(d)) as DocRoot;
  walk(copy, (n) => {
    if (n.type !== 'text' || !n.text) return;
    n.text = n.text.replace(PLACEHOLDER, (all, key: string) => {
      const v = values[key];
      const clean = typeof v === 'string' ? cleanValue(v) : '';
      return clean === '' ? all : clean;
    });
  });
  const checked = validateDoc(copy);
  return checked.ok ? checked.doc : d;
}

export function templateDoc(
  key: string,
  values: Record<string, string | undefined> = {},
): DocRoot | null {
  const tpl = getTemplate(key);
  return tpl ? applyValues(tpl.doc, values) : null;
}
