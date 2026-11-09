import { z } from 'zod';
import { ALLOWED_MIME_TYPES } from './files';

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
  turnstileToken: z.string().min(1).optional(),
});

export const uploadCompleteSchema = z.object({
  uploadId: z.string().min(1),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;
