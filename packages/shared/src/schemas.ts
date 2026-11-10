import { z } from 'zod';
import { CANDIDATE_RULES, MAX_CANDIDATES, MAX_FIELD_OCCURRENCES } from './extraction';
import { ALLOWED_MIME_TYPES } from './files';
import { MAX_CHARS_PER_PAGE, MAX_PAGES_PER_DOCUMENT, MAX_PAGES_PER_REQUEST } from './quotas';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** Mínimo de 12 caracteres, sem exigir composição (orientação NIST). */
export const passwordSchema = z.string().min(12).max(200);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(100),
  turnstileToken: z.string().min(1).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
  turnstileToken: z.string().min(1).optional(),
});

export const uploadRequestSchema = z.object({
  workspaceId: z.string().min(1),
  folderId: z.string().min(1).nullable().optional(),
  fileName: z.string().trim().min(1).max(255),
  mime: z.enum(ALLOWED_MIME_TYPES),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  /** Quando presente, o envio vira uma nova versão deste documento. */
  documentId: z.string().min(1).optional(),
  /** Permite enviar mesmo que o mesmo SHA-256 já exista no workspace. */
  allowDuplicate: z.boolean().optional(),
  turnstileToken: z.string().min(1).optional(),
});

export const uploadPrecheckSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  folderId: z.string().min(1).nullable().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Nome de pasta sem barras nem caracteres de controle. */
function isValidFolderName(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || ch === '/' || ch === '\\') return false;
  }
  return true;
}
export const folderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isValidFolderName, 'invalid');
export const folderCreateSchema = z.object({
  name: folderNameSchema,
  parentId: z.string().min(1).nullable().optional(),
});
export const folderUpdateSchema = z
  .object({ name: folderNameSchema.optional(), parentId: z.string().min(1).nullable().optional() })
  .refine((v) => v.name !== undefined || v.parentId !== undefined, 'empty');

export const documentPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    folderId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.folderId !== undefined, 'empty');

export const EXTRACTORS = ['client', 'client_ocr'] as const;
export const PAGE_KINDS = ['page', 'section'] as const;

export const pagesUploadSchema = z.object({
  pages: z
    .array(
      z.object({
        pageNumber: z.number().int().min(1).max(MAX_PAGES_PER_DOCUMENT),
        text: z.string().max(MAX_CHARS_PER_PAGE),
      }),
    )
    .min(1)
    .max(MAX_PAGES_PER_REQUEST),
  extractedBy: z.enum(EXTRACTORS),
});

export const extractionCompleteSchema = z.object({
  status: z.enum(['extracted', 'needs_ocr', 'extraction_failed']),
  pageCount: z.number().int().min(0).max(MAX_PAGES_PER_DOCUMENT).optional(),
  pageKind: z.enum(PAGE_KINDS).default('page'),
  extractedBy: z.enum(EXTRACTORS).default('client'),
  language: z.string().max(16).optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(200),
  folderId: z.string().min(1).optional(),
  /** Restringe a busca a um documento ("Busca no documento"). */
  documentId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(1000).default(0),
});

const pageNo = z.number().int().min(1).max(MAX_PAGES_PER_DOCUMENT);

/** Resultado da análise feita no navegador; o servidor reconfere cada item contra o texto. */
export const analysisSchema = z.object({
  language: z.enum(['pt', 'en', 'es', 'und']),
  simhash: z
    .string()
    .regex(/^[0-9a-f]{16}$/)
    .nullable()
    .optional(),
  fields: z
    .array(
      z.object({
        pattern_id: z.string().min(1).max(40),
        page_number: pageNo,
        span_start: z.number().int().min(0),
        span_end: z.number().int().min(1),
        raw_value: z.string().min(1).max(400),
      }),
    )
    .max(MAX_FIELD_OCCURRENCES),
  candidates: z
    .array(
      z.object({
        rule: z.enum(CANDIDATE_RULES),
        page_number: pageNo,
        start: z.number().int().min(0),
        end: z.number().int().min(1),
        raw: z.string().min(1).max(200),
        key: z.string().max(8).optional(),
      }),
    )
    .max(MAX_CANDIDATES),
  acroform: z
    .array(
      z.object({
        pageNumber: pageNo,
        name: z.string().min(1).max(200),
        required: z.boolean(),
        filled: z.boolean(),
      }),
    )
    .max(200)
    .default([]),
  truncated: z
    .object({
      fields: z.number().int().min(0).max(1_000_000),
      candidates: z.number().int().min(0).max(1_000_000),
    })
    .optional(),
});
export type AnalysisInput = z.infer<typeof analysisSchema>;

export const CONSENT_PURPOSES = ['browser_ocr'] as const;
export const consentSchema = z.object({ purpose: z.enum(CONSENT_PURPOSES) });

export const uploadCompleteSchema = z.object({
  uploadId: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;
