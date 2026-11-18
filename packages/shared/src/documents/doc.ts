/**
 * Documento do editor (Tiptap JSON), Fase 6 / D15. O conteúdo vem do navegador e NÃO é confiável:
 * `validateDoc` aceita só os nós e marcas do editor (StarterKit + Table + Image + Link), remove
 * atributos desconhecidos, limita tamanho/profundidade e só deixa passar links http/https/mailto
 * e imagens `data:` PNG/JPEG/GIF. Sem múltiplas colunas e sem quebra de página manual.
 */

export type Mark =
  { type: 'bold' | 'italic' | 'strike' | 'code' } | { type: 'link'; attrs: { href: string } };

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: Mark[];
}
export interface DocRoot extends DocNode {
  type: 'doc';
  content: DocNode[];
}

export const MAX_DOC_JSON_CHARS = 900_000;
export const MAX_DOC_NODES = 20_000;
export const MAX_DOC_DEPTH = 12;
export const MAX_TEXT_CHARS = 20_000;
export const MAX_TITLE_CHARS = 200;

const BLOCK_CHILDREN = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'codeBlock',
  'horizontalRule',
  'table',
  'image',
];
const ALLOWED_CHILDREN: Record<string, readonly string[]> = {
  doc: BLOCK_CHILDREN,
  paragraph: ['text', 'hardBreak', 'image'],
  heading: ['text', 'hardBreak'],
  codeBlock: ['text'],
  blockquote: ['paragraph', 'bulletList', 'orderedList', 'codeBlock', 'horizontalRule'],
  bulletList: ['listItem'],
  orderedList: ['listItem'],
  listItem: ['paragraph', 'bulletList', 'orderedList'],
  table: ['tableRow'],
  tableRow: ['tableCell', 'tableHeader'],
  tableCell: ['paragraph'],
  tableHeader: ['paragraph'],
  horizontalRule: [],
  hardBreak: [],
  image: [],
  text: [],
};
const MARKS = ['bold', 'italic', 'strike', 'code'];
const IMAGE_RE = /^data:image\/(?:png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

export type DocResult = { ok: true; doc: DocRoot } | { ok: false; error: string };

/** Só http, https e mailto; nada de `javascript:`, `data:` ou esquemas relativos. */
export function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  const t = href.trim();
  if (t.length === 0 || t.length > 2000) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000- \u007f]/.test(t)) return null;
  try {
    const u = new URL(t);
    return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? t : null;
  } catch {
    return null;
  }
}

function cleanText(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    // Mantém tab e quebra de linha; descarta demais controles.
    if (c === 9 || c === 10 || (c >= 32 && c !== 127)) out += ch;
  }
  return out;
}

class Budget {
  nodes = 0;
}

function intIn(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

function sanitizeNode(raw: unknown, parent: string, depth: number, b: Budget): DocNode | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'nó inválido';
  const n = raw as Record<string, unknown>;
  const type = n['type'];
  if (typeof type !== 'string' || !(type in ALLOWED_CHILDREN)) {
    return `nó não permitido: ${typeof type === 'string' ? type.slice(0, 30) : '?'}`;
  }
  if (!ALLOWED_CHILDREN[parent]?.includes(type))
    return `${type} não é permitido dentro de ${parent}`;
  if (depth > MAX_DOC_DEPTH) return 'documento aninhado demais';
  if (++b.nodes > MAX_DOC_NODES) return 'documento grande demais';

  const out: DocNode = { type };
  const attrs = (typeof n['attrs'] === 'object' && n['attrs'] !== null ? n['attrs'] : {}) as Record<
    string,
    unknown
  >;

  if (type === 'text') {
    if (typeof n['text'] !== 'string') return 'texto inválido';
    const text = cleanText(n['text']);
    if (text.length > MAX_TEXT_CHARS) return 'trecho de texto grande demais';
    if (text.length === 0) return 'texto vazio';
    out.text = text;
    const marks: Mark[] = [];
    for (const m of Array.isArray(n['marks']) ? n['marks'] : []) {
      const mt = (m as { type?: unknown } | null)?.type;
      if (typeof mt !== 'string') return 'marca inválida';
      if (MARKS.includes(mt)) marks.push({ type: mt as 'bold' });
      else if (mt === 'link') {
        const href = safeHref((m as { attrs?: { href?: unknown } }).attrs?.href);
        if (!href) return 'link não permitido (use http, https ou mailto)';
        marks.push({ type: 'link', attrs: { href } });
      } else return `marca não permitida: ${mt.slice(0, 30)}`;
    }
    if (marks.length) out.marks = marks;
    return out;
  }

  if (type === 'heading') out.attrs = { level: intIn(attrs['level'], 1, 3, 2) };
  if (type === 'orderedList') out.attrs = { start: intIn(attrs['start'], 1, 9999, 1) };
  if (type === 'tableCell' || type === 'tableHeader') {
    out.attrs = {
      colspan: intIn(attrs['colspan'], 1, 12, 1),
      rowspan: intIn(attrs['rowspan'], 1, 12, 1),
    };
  }
  if (type === 'image') {
    const src = attrs['src'];
    if (typeof src !== 'string' || !IMAGE_RE.test(src)) {
      return 'imagem não permitida (só PNG, JPEG ou GIF embutidos)';
    }
    const alt = typeof attrs['alt'] === 'string' ? cleanText(attrs['alt']).slice(0, 300) : '';
    out.attrs = { src, alt };
    return out;
  }

  const kids = n['content'];
  if (kids !== undefined) {
    if (!Array.isArray(kids)) return 'conteúdo inválido';
    const content: DocNode[] = [];
    for (const k of kids) {
      const r = sanitizeNode(k, type, depth + 1, b);
      if (typeof r === 'string') return r;
      content.push(r);
    }
    if (content.length) out.content = content;
  }
  return out;
}

export function emptyDoc(): DocRoot {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** Valida e normaliza. Devolve uma CÓPIA limpa; o que sobra é só o que o editor produz. */
export function validateDoc(input: unknown): DocResult {
  if (typeof input !== 'object' || input === null)
    return { ok: false, error: 'documento inválido' };
  if (JSON.stringify(input).length > MAX_DOC_JSON_CHARS) {
    return { ok: false, error: 'documento grande demais' };
  }
  if ((input as { type?: unknown }).type !== 'doc')
    return { ok: false, error: 'documento inválido' };
  const b = new Budget();
  const kids = (input as { content?: unknown }).content;
  if (!Array.isArray(kids)) return { ok: false, error: 'documento inválido' };
  const content: DocNode[] = [];
  for (const k of kids) {
    const r = sanitizeNode(k, 'doc', 1, b);
    if (typeof r === 'string') return { ok: false, error: r };
    content.push(r);
  }
  return {
    ok: true,
    doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] },
  };
}

export function parseDoc(json: string): DocResult {
  if (json.length > MAX_DOC_JSON_CHARS) return { ok: false, error: 'documento grande demais' };
  try {
    return validateDoc(JSON.parse(json));
  } catch {
    return { ok: false, error: 'JSON inválido' };
  }
}

export function walk(node: DocNode, fn: (n: DocNode) => void): void {
  fn(node);
  for (const c of node.content ?? []) walk(c, fn);
}

export function docStats(doc: DocRoot): { chars: number; words: number } {
  let text = '';
  walk(doc, (n) => {
    if (n.type === 'text') text += `${n.text} `;
  });
  const t = text.trim();
  return { chars: t.length, words: t === '' ? 0 : t.split(/\s+/).length };
}
