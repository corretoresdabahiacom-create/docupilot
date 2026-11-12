/**
 * Perfil de dados pessoais (Fase 5): conjunto de dados que a PESSOA escolhe guardar para
 * preencher formulários. É dado sensível (LGPD); o servidor guarda criptografado.
 */
import { z } from 'zod';
import {
  CANON_KEYS,
  canonicalize,
  type CanonKey,
} from '../extraction/patterns/acroform_type_mapping';

export const PROFILE_LABEL_MAX = 80;
export const MAX_PROFILES_PER_USER = 10;
export const PROFILE_CONSENT_PURPOSE = 'pii_profile' as const;

export type ProfileFields = Partial<Record<CanonKey, string>>;

export const profileInputSchema = z.object({
  label: z.string().trim().min(1).max(PROFILE_LABEL_MAX),
  fields: z
    .object(
      Object.fromEntries(CANON_KEYS.map((k) => [k, z.string().max(200).optional()])) as Record<
        CanonKey,
        z.ZodOptional<z.ZodString>
      >,
    )
    .strict(),
});
export type ProfileInput = z.infer<typeof profileInputSchema>;

/** Confirmação explícita exigida para exportar e excluir um perfil. */
export const profileConfirmSchema = z.object({ confirm: z.literal(true) });

export type NormalizedProfile =
  { ok: true; fields: ProfileFields } | { ok: false; invalid: CanonKey[]; empty: boolean };

/**
 * Valida cada campo preenchido (CPF com dígito verificador, data real, e-mail…) e devolve a
 * forma canônica. Campos vazios são descartados; perfil sem nenhum campo é recusado.
 */
export function normalizeProfileFields(
  input: ProfileInput['fields'],
  now: Date = new Date(),
): NormalizedProfile {
  const fields: ProfileFields = {};
  const invalid: CanonKey[] = [];
  for (const key of CANON_KEYS) {
    const raw = input[key];
    if (raw === undefined || raw.trim() === '') continue;
    const value = canonicalize(key, raw, now);
    if (value === null) invalid.push(key);
    else fields[key] = value;
  }
  if (invalid.length > 0) return { ok: false, invalid, empty: false };
  if (Object.keys(fields).length === 0) return { ok: false, invalid: [], empty: true };
  return { ok: true, fields };
}
