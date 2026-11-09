/** Quotas padrão do MVP gratuito (docs/decisions.md D4). Sobrescrevíveis via system_settings. */
export const DEFAULT_QUOTAS = {
  storageBytesPerWorkspace: 1 * 1024 ** 3,
  storageBytesGlobal: 8 * 1024 ** 3,
  maxFileBytes: 25 * 1024 ** 2,
  documentsPerWorkspace: 200,
  extractionsPerMonth: 300,
  exportsPerMonth: 100,
  membersPerWorkspace: 5,
  d1WritesPerDayBudget: 80_000,
} as const;

export type Quotas = { -readonly [K in keyof typeof DEFAULT_QUOTAS]: number };

export const MAX_FOLDER_DEPTH = 5;
export const MAX_VERSIONS_PER_DOCUMENT = 50;
export const UPLOAD_URL_TTL_SECONDS = 300;
export const DOWNLOAD_URL_TTL_SECONDS = 900;
export const SESSION_TTL_DAYS = 30;

/** Códigos de erro estáveis devolvidos pela API. */
export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_ERROR',
  'QUOTA_EXCEEDED',
  'STORAGE_NOT_CONFIGURED',
  'SERVICE_NOT_CONFIGURED',
  'FILE_TYPE_NOT_ALLOWED',
  'FILE_TOO_LARGE',
  'FILE_CONTENT_MISMATCH',
  'RATE_LIMITED',
  'CONFLICT',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];
