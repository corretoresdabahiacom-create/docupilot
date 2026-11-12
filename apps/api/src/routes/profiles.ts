/**
 * Perfis de dados pessoais (Fase 5, D14). Dado sensível (LGPD):
 * - criptografado em repouso (AES-GCM) e nunca devolvido em listagens;
 * - criar/alterar exige consentimento ativo `pii_profile`; ler, exportar e excluir seguem
 *   permitidos mesmo após revogar (direito de acesso e de eliminação);
 * - toda leitura, exportação, alteração e exclusão gera auditoria (só metadados, sem o conteúdo).
 */
import { and, count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  MAX_PROFILES_PER_USER,
  normalizeProfileFields,
  PROFILE_CONSENT_PURPOSE,
  profileConfirmSchema,
  profileInputSchema,
  type ProfileFields,
} from '@docupilot/shared';
import { runBatch } from '../db/batch';
import { decryptProfile, encryptProfile } from '../crypto/pii';
import { extractedFields, personalDataProfiles } from '../db/schema';
import { AppError, notFound } from '../errors';
import { auditEntry, parseBody } from '../http';
import { requireAuth } from '../middleware/auth';
import type { AppVariables } from '../types';
import { hasActiveConsent } from './consents';

export const profileRoutes = new Hono<{ Variables: AppVariables }>();
profileRoutes.use('*', requireAuth);

const consentRequired = () =>
  new AppError(
    'CONSENT_REQUIRED',
    403,
    'É preciso consentir com o armazenamento de dados pessoais antes de salvar um perfil.',
  );

function invalidFields(invalid: string[]) {
  return new AppError('VALIDATION_ERROR', 400, `Dados inválidos: ${invalid.join(', ')}.`);
}

async function loadOwned(
  c: { get: (k: 'deps') => { db: import('../types').Db }; req: { param: (n: string) => string } },
  userId: string,
) {
  const rows = await c
    .get('deps')
    .db.select()
    .from(personalDataProfiles)
    .where(
      and(eq(personalDataProfiles.id, c.req.param('id')), eq(personalDataProfiles.userId, userId)),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw notFound();
  return row;
}

/** Só metadados: nunca devolve conteúdo nem quais campos existem. */
profileRoutes.get('/', async (c) => {
  const rows = await c
    .get('deps')
    .db.select({
      id: personalDataProfiles.id,
      label: personalDataProfiles.label,
      createdAt: personalDataProfiles.createdAt,
      updatedAt: personalDataProfiles.updatedAt,
    })
    .from(personalDataProfiles)
    .where(eq(personalDataProfiles.userId, c.get('user').id))
    .orderBy(desc(personalDataProfiles.createdAt));
  return c.json({ profiles: rows, max: MAX_PROFILES_PER_USER });
});

profileRoutes.post('/', async (c) => {
  const { db, config } = c.get('deps');
  const user = c.get('user');
  const input = await parseBody(c, profileInputSchema);
  const norm = normalizeProfileFields(input.fields);
  if (!norm.ok) {
    throw norm.empty
      ? new AppError('VALIDATION_ERROR', 400, 'Preencha ao menos um campo.')
      : invalidFields(norm.invalid);
  }
  if (!(await hasActiveConsent(db, user.id, PROFILE_CONSENT_PURPOSE))) throw consentRequired();
  const total = await db
    .select({ n: count() })
    .from(personalDataProfiles)
    .where(eq(personalDataProfiles.userId, user.id));
  if ((total[0]?.n ?? 0) >= MAX_PROFILES_PER_USER) {
    throw new AppError(
      'QUOTA_EXCEEDED',
      429,
      `Limite de ${MAX_PROFILES_PER_USER} perfis atingido.`,
    );
  }
  const id = crypto.randomUUID();
  const sealed = await encryptProfile(config.piiKey, id, user.id, norm.fields);
  await runBatch(db, [
    db.insert(personalDataProfiles).values({ id, userId: user.id, label: input.label, ...sealed }),
    auditEntry(db, {
      userId: user.id,
      action: 'profile.created',
      targetType: 'personal_data_profile',
      targetId: id,
    }),
  ]);
  return c.json({ id, label: input.label }, 201);
});

/** Leitura decifra e SEMPRE audita. */
profileRoutes.get('/:id', async (c) => {
  const { db, config } = c.get('deps');
  const user = c.get('user');
  const row = await loadOwned(c, user.id);
  const fields = await decryptProfile<ProfileFields>(config.piiKey, row.id, user.id, row);
  await auditEntry(db, {
    userId: user.id,
    action: 'profile.read',
    targetType: 'personal_data_profile',
    targetId: row.id,
  });
  return c.json({ id: row.id, label: row.label, fields, updatedAt: row.updatedAt });
});

profileRoutes.put('/:id', async (c) => {
  const { db, config } = c.get('deps');
  const user = c.get('user');
  const row = await loadOwned(c, user.id);
  const input = await parseBody(c, profileInputSchema);
  const norm = normalizeProfileFields(input.fields);
  if (!norm.ok) {
    throw norm.empty
      ? new AppError('VALIDATION_ERROR', 400, 'Preencha ao menos um campo.')
      : invalidFields(norm.invalid);
  }
  if (!(await hasActiveConsent(db, user.id, PROFILE_CONSENT_PURPOSE))) throw consentRequired();
  const sealed = await encryptProfile(config.piiKey, row.id, user.id, norm.fields);
  await runBatch(db, [
    db
      .update(personalDataProfiles)
      .set({ label: input.label, ...sealed, updatedAt: Date.now() })
      .where(and(eq(personalDataProfiles.id, row.id), eq(personalDataProfiles.userId, user.id))),
    auditEntry(db, {
      userId: user.id,
      action: 'profile.updated',
      targetType: 'personal_data_profile',
      targetId: row.id,
    }),
  ]);
  return c.json({ id: row.id, label: input.label });
});

/** Exportação (LGPD: acesso/portabilidade): exige confirmação e é auditada. */
profileRoutes.post('/:id/export', async (c) => {
  const { db, config } = c.get('deps');
  const user = c.get('user');
  await parseBody(c, profileConfirmSchema);
  const row = await loadOwned(c, user.id);
  const fields = await decryptProfile<ProfileFields>(config.piiKey, row.id, user.id, row);
  await auditEntry(db, {
    userId: user.id,
    action: 'profile.exported',
    targetType: 'personal_data_profile',
    targetId: row.id,
  });
  return c.json({ id: row.id, label: row.label, fields, exportedAt: Date.now() });
});

/** Exclusão: remove o perfil e qualquer campo extraído que aponte para ele. */
profileRoutes.delete('/:id', async (c) => {
  const { db } = c.get('deps');
  const user = c.get('user');
  await parseBody(c, profileConfirmSchema);
  const row = await loadOwned(c, user.id);
  await runBatch(db, [
    db.delete(extractedFields).where(eq(extractedFields.personalProfileId, row.id)),
    db
      .delete(personalDataProfiles)
      .where(and(eq(personalDataProfiles.id, row.id), eq(personalDataProfiles.userId, user.id))),
    auditEntry(db, {
      userId: user.id,
      action: 'profile.deleted',
      targetType: 'personal_data_profile',
      targetId: row.id,
    }),
  ]);
  return c.json({ deleted: true });
});
