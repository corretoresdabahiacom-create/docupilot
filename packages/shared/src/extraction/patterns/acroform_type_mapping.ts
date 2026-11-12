/**
 * Pattern acroform_type_mapping — docs/heuristics.md §10.2.
 * Liga o NOME de um campo de formulário a um dado conhecido (CPF, nascimento…) por:
 *   1. tabela de equivalência curada (nome do campo igual a um apelido conhecido) → `table`;
 *   2. regex sobre o nome (o nome apenas CONTÉM o termo) → `regex`, de menor confiança.
 * Também valida e formata o valor para o tipo do campo (texto, caixa, lista).
 * Heurística de nomes: um nome que cita outra pessoa (cônjuge, responsável…) NUNCA é ligado,
 * para não colocar os dados do usuário no campo de outra pessoa.
 */
import { isValidCNPJ } from './cnpj_strict';
import { isValidCPF } from './cpf_strict';
import type { FormField } from './acroform_field';
import { stripAccents } from '../util';

export const PATTERN_ID = 'acroform_type_mapping' as const;

export const CANON_KEYS = [
  'full_name',
  'cpf',
  'cnpj',
  'rg',
  'cnh',
  'passport',
  'birth_date',
  'mother_name',
  'nationality',
  'email',
  'phone',
  'cep',
  'address',
  'address_number',
  'address_complement',
  'neighborhood',
  'city',
  'state',
] as const;
export type CanonKey = (typeof CANON_KEYS)[number];

/** Apelidos (já normalizados) que identificam cada dado. Curada à mão; ver docs/heuristics.md. */
export const EQUIVALENCE: Record<CanonKey, string[]> = {
  full_name: [
    'nome',
    'nome_completo',
    'full_name',
    'name',
    'nome_do_titular',
    'nome_titular',
    'nome_do_requerente',
    'nome_requerente',
    'nome_do_declarante',
    'nome_declarante',
    'nome_do_solicitante',
    'nome_solicitante',
  ],
  cpf: [
    'cpf',
    'numero_cpf',
    'n_cpf',
    'cpf_numero',
    'cpf_titular',
    'cpf_do_titular',
    'cpf_requerente',
    'cpf_do_requerente',
    'cpf_declarante',
    'cpf_solicitante',
  ],
  cnpj: ['cnpj', 'numero_cnpj', 'n_cnpj', 'cnpj_numero'],
  rg: ['rg', 'numero_rg', 'n_rg', 'identidade', 'registro_geral', 'carteira_de_identidade'],
  cnh: ['cnh', 'numero_cnh', 'n_cnh', 'carteira_de_habilitacao'],
  passport: ['passaporte', 'numero_passaporte', 'passport', 'passport_number'],
  birth_date: [
    'data_nascimento',
    'data_de_nascimento',
    'dt_nascimento',
    'dt_nasc',
    'data_nasc',
    'nascimento',
    'birth_date',
    'birthdate',
    'date_of_birth',
    'dob',
  ],
  mother_name: ['nome_da_mae', 'nome_mae', 'mae', 'filiacao_mae', 'mother_name', 'mothers_name'],
  nationality: ['nacionalidade', 'nationality'],
  email: ['email', 'e_mail', 'correio_eletronico', 'email_pessoal', 'endereco_de_email'],
  phone: [
    'telefone',
    'celular',
    'fone',
    'tel',
    'phone',
    'telefone_celular',
    'telefone_contato',
    'whatsapp',
  ],
  cep: ['cep', 'codigo_postal', 'zip', 'zip_code', 'postal_code'],
  address: [
    'endereco',
    'logradouro',
    'rua',
    'address',
    'street',
    'endereco_residencial',
    'endereco_completo',
  ],
  address_number: ['numero_endereco', 'numero_residencia', 'n_endereco', 'address_number'],
  address_complement: ['complemento', 'address_complement'],
  neighborhood: ['bairro', 'neighborhood'],
  city: ['cidade', 'municipio', 'city'],
  state: ['uf', 'estado', 'state'],
};

/** Termos que, sozinhos no nome, sugerem o dado (menor confiança que a tabela). */
const NAME_REGEX: Array<{ key: CanonKey; re: RegExp; not?: RegExp }> = [
  { key: 'cpf', re: /(^|_)cpf(_|$)/ },
  { key: 'cnpj', re: /(^|_)cnpj(_|$)/ },
  { key: 'rg', re: /(^|_)rg(_|$)/ },
  { key: 'cnh', re: /(^|_)cnh(_|$)/ },
  {
    key: 'birth_date',
    re: /(^|_)(nasc|nascimento)(_|$)/,
    not: /(^|_)(local|cidade|municipio|naturalidade|estado|uf|pais)(_|$)/,
  },
  { key: 'email', re: /(^|_)e?_?mail(_|$)/ },
  { key: 'cep', re: /(^|_)cep(_|$)/ },
  { key: 'phone', re: /(^|_)(telefone|celular|fone|whatsapp)(_|$)/ },
];

/** Palavras que indicam que o campo é de OUTRA pessoa. */
export const OTHER_PERSON_WORDS = [
  'conjuge',
  'esposo',
  'esposa',
  'companheiro',
  'companheira',
  'responsavel',
  'representante',
  'procurador',
  'testemunha',
  'fiador',
  'avalista',
  'socio',
  'tutor',
  'dependente',
  'filho',
  'filha',
  'pai',
  'mae',
  'avo',
  'empregador',
  'emergencia',
  'referencia',
  'beneficiario',
  'contato',
] as const;

export type NameMatch =
  | { kind: 'match'; key: CanonKey; via: 'table' | 'regex' }
  | { kind: 'other_person' }
  | { kind: 'none' };

const aliasIndex = new Map<string, CanonKey>();
for (const key of CANON_KEYS) for (const alias of EQUIVALENCE[key]) aliasIndex.set(alias, key);

function mentionsOtherPerson(tokens: string[]): boolean {
  return tokens.some((t) => (OTHER_PERSON_WORDS as readonly string[]).includes(t));
}

/** Liga o nome do campo a um dado conhecido, ou diz por que não ligou. */
export function mapFieldName(field: Pick<FormField, 'leaf' | 'parents'>): NameMatch {
  const tokens = [...field.parents, field.leaf].flatMap((s) => s.split('_')).filter(Boolean);
  let hit: { key: CanonKey; via: 'table' | 'regex' } | null = null;
  const exact = aliasIndex.get(field.leaf);
  if (exact) hit = { key: exact, via: 'table' };
  else {
    for (const rule of NAME_REGEX) {
      if (rule.re.test(field.leaf) && !(rule.not && rule.not.test(field.leaf))) {
        hit = { key: rule.key, via: 'regex' };
        break;
      }
    }
  }
  if (!hit) return { kind: 'none' };
  // O próprio apelido de "nome da mãe" cita outra pessoa de propósito.
  if (hit.key !== 'mother_name' && mentionsOtherPerson(tokens)) return { kind: 'other_person' };
  return { kind: 'match', ...hit };
}

// ---------- valores: forma canônica, formatação e validação ----------

export const UF_LIST = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;

const digits = (s: string) => s.replace(/\D/g, '');

function isRealDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Aceita dd/mm/aaaa, dd-mm-aaaa, ddmmaaaa e aaaa-mm-dd; devolve aaaa-mm-dd ou null. */
export function parseBirthDate(input: string, now: Date = new Date()): string | null {
  const t = input.trim();
  let y: number, m: number, d: number;
  let mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (mt) [y, m, d] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else if (
    (mt = /^(\d{2})[/.-](\d{2})[/.-](\d{4})$/.exec(t)) ||
    (mt = /^(\d{2})(\d{2})(\d{4})$/.exec(t))
  )
    [d, m, y] = [Number(mt[1]), Number(mt[2]), Number(mt[3])];
  else return null;
  if (y < 1900 || !isRealDate(y, m, d)) return null;
  if (Date.UTC(y, m - 1, d) > now.getTime()) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Caractere de controle (C0 ou DEL): nunca vale como dado pessoal. */
function hasControlChar(text: string): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/**
 * Forma canônica de um dado (a que fica guardada no perfil e nas fontes): CPF/CNPJ/CEP/telefone
 * só com dígitos, nascimento em aaaa-mm-dd, e-mail em minúsculas, UF em maiúsculas.
 * Devolve null se o valor não é válido para o tipo.
 */
export function canonicalize(key: CanonKey, input: string, now: Date = new Date()): string | null {
  const t = input.trim();
  if (t === '' || hasControlChar(t)) return null;
  switch (key) {
    case 'cpf': {
      const d = digits(t);
      return isValidCPF(d) ? d : null;
    }
    case 'cnpj': {
      const d = digits(t);
      return d.length === 14 && isValidCNPJ(d) ? d : null;
    }
    case 'cep': {
      const d = digits(t);
      return d.length === 8 ? d : null;
    }
    case 'phone': {
      let d = digits(t);
      if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
      return d.length === 10 || d.length === 11 ? d : null;
    }
    case 'birth_date':
      return parseBirthDate(t, now);
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t) && t.length <= 254 ? t.toLowerCase() : null;
    case 'state': {
      const u = stripAccents(t).toUpperCase();
      return u.length === 2 ? ((UF_LIST as readonly string[]).includes(u) ? u : null) : t;
    }
    default:
      return t.length <= 200 ? t : null;
  }
}

/** Formata o valor canônico como um campo brasileiro costuma esperar, respeitando maxLength. */
export function formatForField(key: CanonKey, canonical: string, maxLength: number | null): string {
  const max = maxLength ?? Infinity;
  switch (key) {
    case 'cpf':
      return max >= 14
        ? `${canonical.slice(0, 3)}.${canonical.slice(3, 6)}.${canonical.slice(6, 9)}-${canonical.slice(9)}`
        : canonical;
    case 'cnpj':
      return max >= 18
        ? `${canonical.slice(0, 2)}.${canonical.slice(2, 5)}.${canonical.slice(5, 8)}/${canonical.slice(8, 12)}-${canonical.slice(12)}`
        : canonical;
    case 'cep':
      return max >= 9 ? `${canonical.slice(0, 5)}-${canonical.slice(5)}` : canonical;
    case 'phone': {
      const ddd = canonical.slice(0, 2);
      const local = canonical.slice(2);
      const split = local.length === 9 ? 5 : 4;
      const pretty = `(${ddd}) ${local.slice(0, split)}-${local.slice(split)}`;
      return max >= pretty.length ? pretty : canonical;
    }
    case 'birth_date': {
      const [y, m, d] = canonical.split('-') as [string, string, string];
      if (max >= 10) return `${d}/${m}/${y}`;
      return max >= 8 ? `${d}${m}${y}` : canonical;
    }
    default:
      return canonical;
  }
}

export type ValueError =
  'empty' | 'invalid_format' | 'too_long' | 'not_in_options' | 'not_boolean' | 'encoding';

export type ValueCheck = { ok: true; value: string | boolean } | { ok: false; error: ValueError };

// Caracteres fora do Latin-1 que o WinAnsi (fonte padrão do PDF) também cobre.
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'.split(''));

/** A fonte padrão dos formulários (Helvetica/WinAnsi) só desenha estes caracteres. */
export function isWinAnsiEncodable(text: string, allowNewline: boolean): boolean {
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if (ch === '\n' || ch === '\r') {
      if (!allowNewline) return false;
      continue;
    }
    if (c < 0x20 || (c >= 0x7f && c < 0xa0)) return false;
    if (c > 0xff && !WIN_ANSI_EXTRA.has(ch)) return false;
  }
  return true;
}

const optionKey = (s: string) => stripAccents(s).toLowerCase().replace(/\s+/g, ' ').trim();

/** Procura a opção do campo equivalente ao texto (sem acento, sem diferença de caixa). */
export function matchOption(options: string[], text: string): string | null {
  const k = optionKey(text);
  return options.find((o) => optionKey(o) === k) ?? null;
}

const TRUE_WORDS = new Set(['true', 'sim', 's', 'yes', 'y', 'x', '1', 'on']);
const FALSE_WORDS = new Set(['false', 'nao', 'n', 'no', '0', 'off', '']);

/**
 * Confere um valor para o campo do PDF: tipo (texto, caixa, lista), tamanho, opções, codificação e,
 * quando o campo está ligado a um dado conhecido, o formato desse dado.
 */
export function validateValue(
  field: Pick<FormField, 'kind' | 'options' | 'maxLength' | 'multiline'>,
  key: CanonKey | null,
  value: string | boolean,
  now: Date = new Date(),
): ValueCheck {
  if (field.kind === 'checkbox') {
    if (typeof value === 'boolean') return { ok: true, value };
    const k = stripAccents(value).toLowerCase().trim();
    if (TRUE_WORDS.has(k)) return { ok: true, value: true };
    if (FALSE_WORDS.has(k)) return { ok: true, value: false };
    return { ok: false, error: 'not_boolean' };
  }
  if (typeof value !== 'string') return { ok: false, error: 'invalid_format' };
  const text = value.trim();
  if (text === '') return { ok: false, error: 'empty' };
  if (field.kind === 'choice') {
    const opt = matchOption(field.options, text);
    return opt === null ? { ok: false, error: 'not_in_options' } : { ok: true, value: opt };
  }
  if (field.kind !== 'text') return { ok: false, error: 'invalid_format' };
  if (field.maxLength !== null && text.length > field.maxLength)
    return { ok: false, error: 'too_long' };
  if (!isWinAnsiEncodable(text, field.multiline)) return { ok: false, error: 'encoding' };
  if (key !== null && canonicalize(key, text, now) === null)
    return { ok: false, error: 'invalid_format' };
  return { ok: true, value: text };
}
