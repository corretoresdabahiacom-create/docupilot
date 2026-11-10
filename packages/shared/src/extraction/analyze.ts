/**
 * Orquestra os padrões de extração. O navegador chama `analyzePages`; o Worker chama
 * `verifyField` / `verifyCandidate` para reconferir CADA item recebido contra o texto
 * armazenado, de modo que o servidor nunca grava um campo que o texto não sustenta.
 */
import { detectLanguage } from './patterns/language_detect';
import { simhash64 } from './patterns/dedup_simhash';
import { extractAddressHeuristic } from './patterns/address_br_heuristic';
import { extractAddressStructured } from './patterns/address_br_structured';
import { extractCEP } from './patterns/cep_strict';
import { extractCNPJ, findInvalidCNPJ } from './patterns/cnpj_strict';
import { extractCPF, findInvalidCPF } from './patterns/cpf_strict';
import { extractCurrencyBRL } from './patterns/currency_brl';
import { extractCurrencyEUR } from './patterns/currency_eur';
import { extractCurrencyUSD } from './patterns/currency_usd';
import { extractCurrencyWrittenBR } from './patterns/currency_written_br';
import { extractDateBR } from './patterns/date_br_numeric';
import { extractDateExtenso } from './patterns/date_br_extenso';
import { extractDateISO } from './patterns/date_iso';
import { extractDateUS } from './patterns/date_us_numeric';
import { extractEmail } from './patterns/email_strict';
import { extractInvoiceNumber } from './patterns/invoice_number';
import { extractPercentage } from './patterns/money_percentage';
import { extractPhoneLandline } from './patterns/phone_br_landline';
import { extractPhoneMobile } from './patterns/phone_br_mobile';
import { extractPONumber } from './patterns/po_number';
import { extractProcessNumber } from './patterns/process_number_br';
import {
  MIN_CONFIDENCE,
  type ExtractedField,
  type ExtractOptions,
  type Lang,
  type PatternFn,
} from './types';
import { VERIFY_WINDOW } from './util';
import { findAnnexMentions } from './annex';

export const FIELD_PATTERNS: Record<string, PatternFn> = {
  cpf_strict: extractCPF,
  cnpj_strict: extractCNPJ,
  email_strict: extractEmail,
  cep_strict: extractCEP,
  phone_br_mobile: extractPhoneMobile,
  phone_br_landline: extractPhoneLandline,
  date_iso: extractDateISO,
  date_br_numeric: extractDateBR,
  date_us_numeric: extractDateUS,
  date_br_extenso: extractDateExtenso,
  currency_brl: extractCurrencyBRL,
  currency_usd: extractCurrencyUSD,
  currency_eur: extractCurrencyEUR,
  currency_written_br: extractCurrencyWrittenBR,
  money_percentage: extractPercentage,
  invoice_number: extractInvoiceNumber,
  process_number_br: extractProcessNumber,
  po_number: extractPONumber,
  address_br_structured: extractAddressStructured,
  address_br_heuristic: extractAddressHeuristic,
};

export const MAX_RAW_LENGTH = 400;

const overlaps = (a: ExtractedField, b: ExtractedField) =>
  a.text_span_start < b.text_span_end && b.text_span_start < a.text_span_end;

/** Roda todos os padrões numa página; em sobreposição prevalece a maior confiança. */
export function extractAll(
  text: string,
  documentId: string,
  pageNumber: number,
  opts: ExtractOptions = {},
): ExtractedField[] {
  const all: ExtractedField[] = [];
  for (const fn of Object.values(FIELD_PATTERNS)) {
    for (const f of fn(text, documentId, pageNumber, opts)) {
      if (f.confidence >= MIN_CONFIDENCE && f.raw_value.length <= MAX_RAW_LENGTH) all.push(f);
    }
  }
  all.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      b.text_span_end - b.text_span_start - (a.text_span_end - a.text_span_start) ||
      a.text_span_start - b.text_span_start,
  );
  const kept: ExtractedField[] = [];
  for (const f of all) {
    const clash = kept.some(
      (k) => overlaps(f, k) && k.field_type !== 'address' && f.field_type !== 'address',
    );
    if (!clash) kept.push(f);
  }
  return kept.sort((a, b) => a.text_span_start - b.text_span_start);
}

export interface SubmittedField {
  pattern_id: string;
  page_number: number;
  span_start: number;
  span_end: number;
  raw_value: string;
}

/**
 * Reconfere um campo contra o texto da página. Devolve o campo REGENERADO pelo padrão (valor
 * normalizado, confiança, origem e rótulo vêm do código, nunca do cliente) ou `null`.
 */
export function verifyField(
  submitted: SubmittedField,
  pageText: string,
  documentId: string,
  language: Lang,
): ExtractedField | null {
  const fn = FIELD_PATTERNS[submitted.pattern_id];
  if (!fn) return null;
  const { span_start: start, span_end: end, raw_value: raw } = submitted;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end <= start || end > pageText.length) return null;
  if (raw.length > MAX_RAW_LENGTH || pageText.slice(start, end) !== raw) return null;
  const wStart = Math.max(0, start - VERIFY_WINDOW);
  const wEnd = Math.min(pageText.length, end + VERIFY_WINDOW);
  const win = pageText.slice(wStart, wEnd);
  const found = fn(win, documentId, submitted.page_number, { language }).find(
    (f) =>
      f.text_span_start + wStart === start &&
      f.text_span_end + wStart === end &&
      f.raw_value === raw &&
      f.confidence >= MIN_CONFIDENCE,
  );
  if (!found) return null;
  return { ...found, text_span_start: start, text_span_end: end };
}

// ---------- candidatos de inconsistência (reverificados no servidor) ----------

export const CANDIDATE_RULES = ['invalid_cpf', 'invalid_cnpj', 'annex_mention'] as const;
export type CandidateRule = (typeof CANDIDATE_RULES)[number];

export interface Candidate {
  rule: CandidateRule;
  page_number: number;
  start: number;
  end: number;
  raw: string;
  /** Para annex_mention: chave normalizada do anexo ("1", "2", "a"). */
  key?: string;
}

export function findCandidates(text: string, pageNumber: number): Candidate[] {
  const out: Candidate[] = [];
  for (const c of findInvalidCPF(text))
    out.push({
      rule: 'invalid_cpf',
      page_number: pageNumber,
      start: c.start,
      end: c.end,
      raw: c.raw,
    });
  for (const c of findInvalidCNPJ(text))
    out.push({
      rule: 'invalid_cnpj',
      page_number: pageNumber,
      start: c.start,
      end: c.end,
      raw: c.raw,
    });
  for (const a of findAnnexMentions(text))
    out.push({
      rule: 'annex_mention',
      page_number: pageNumber,
      start: a.start,
      end: a.end,
      raw: a.raw,
      key: a.key,
    });
  return out;
}

/** Reconfere um candidato contra o texto; devolve a chave do anexo quando aplicável. */
export function verifyCandidate(c: Candidate, pageText: string): { ok: boolean; key?: string } {
  if (!Number.isInteger(c.start) || !Number.isInteger(c.end)) return { ok: false };
  if (c.start < 0 || c.end <= c.start || c.end > pageText.length) return { ok: false };
  if (c.raw.length > 200 || pageText.slice(c.start, c.end) !== c.raw) return { ok: false };
  const wStart = Math.max(0, c.start - VERIFY_WINDOW);
  const win = pageText.slice(wStart, Math.min(pageText.length, c.end + VERIFY_WINDOW));
  const hit = findCandidates(win, c.page_number).find(
    (x) => x.rule === c.rule && x.start + wStart === c.start && x.end + wStart === c.end,
  );
  return hit ? { ok: true, key: hit.key } : { ok: false };
}

// ---------- análise de documento inteiro (navegador) ----------

export const MAX_FIELD_OCCURRENCES = 400;
export const MAX_CANDIDATES = 100;

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface AnalysisDraft {
  language: Lang;
  languageConfidence: number;
  simhash: string | null;
  fields: SubmittedField[];
  candidates: Candidate[];
  /** Quantas ocorrências foram cortadas pelos limites (aviso ao usuário). */
  truncatedFields: number;
  truncatedCandidates: number;
}

export function analyzePages(pages: PageText[], documentId: string): AnalysisDraft {
  const sample = pages.map((p) => p.text).join('\n');
  const lang = detectLanguage(sample);
  const found: ExtractedField[] = [];
  const candidates: Candidate[] = [];
  for (const p of pages) {
    found.push(...extractAll(p.text, documentId, p.pageNumber, { language: lang.language }));
    candidates.push(...findCandidates(p.text, p.pageNumber));
  }
  found.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.page_number - b.page_number ||
      a.text_span_start - b.text_span_start,
  );
  const kept = found.slice(0, MAX_FIELD_OCCURRENCES);
  return {
    language: lang.language,
    languageConfidence: lang.confidence,
    simhash: simhash64(sample),
    fields: kept.map((f) => ({
      pattern_id: f.pattern_id,
      page_number: f.page_number,
      span_start: f.text_span_start,
      span_end: f.text_span_end,
      raw_value: f.raw_value,
    })),
    candidates: candidates.slice(0, MAX_CANDIDATES),
    truncatedFields: Math.max(0, found.length - kept.length),
    truncatedCandidates: Math.max(0, candidates.length - MAX_CANDIDATES),
  };
}
