export * from './fill';
export * from './profile';
export {
  describeField,
  describeFields,
  nameSegments,
  normalizeSegment,
  MAX_FORM_FIELDS,
  type FieldKind,
  type FormField,
  type PdfFieldType,
  type RawFormField,
  type UnsupportedReason,
} from '../extraction/patterns/acroform_field';
export {
  CANON_KEYS,
  EQUIVALENCE,
  OTHER_PERSON_WORDS,
  UF_LIST,
  canonicalize,
  formatForField,
  isWinAnsiEncodable,
  mapFieldName,
  matchOption,
  parseBirthDate,
  validateValue,
  type CanonKey,
  type NameMatch,
  type ValueCheck,
  type ValueError,
} from '../extraction/patterns/acroform_type_mapping';
