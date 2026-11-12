export * from './types';
export * from './analyze';
export * from './annex';
export * from './inconsistencies';
export * from './money';
export * from './queries';
export { VERIFY_WINDOW, labelBefore } from './util';
export { detectLanguage, type LanguageResult } from './patterns/language_detect';
export { isValidCPF } from './patterns/cpf_strict';
export { isValidCNPJ } from './patterns/cnpj_strict';
export {
  simhash64,
  hammingDistance,
  isPossiblySimilar,
  SIMILAR_MAX_DISTANCE,
} from './patterns/dedup_simhash';
export { isExactDuplicate } from './patterns/dedup_exact';
export { canCompareSimilarity } from './patterns/dedup_failed';
export {
  summarize,
  SUMMARY_MODES,
  type SummaryMode,
  type SummaryResult,
  type SummarySentence,
} from './patterns/summary_textrank';
export * from './compare';
export { MAX_UNITS, toUnits, type Unit, type Context } from './compare_util';
export { splitClauses, clauseKey, type Clause, type ClauseSplit } from './patterns/clause_boundary';
export { diffText, type TextDiff, type TextHunk, type InlinePart } from './patterns/diff_textual';
export {
  diffFields,
  type ComparedField,
  type FieldSide,
  type FieldDiffStatus,
} from './patterns/diff_fields';
export {
  diffClauses,
  RENUMBER_MIN_SIMILARITY,
  type ClauseComparison,
  type ComparedClause,
  type ClauseDiffStatus,
} from './patterns/diff_clause';
