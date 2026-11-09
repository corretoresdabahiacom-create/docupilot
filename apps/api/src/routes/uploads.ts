import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  UPLOAD_URL_TTL_SECONDS,
  uploadRequestSchema,
  validateUpload,
  type ErrorCode,
  type Quotas,
} from '@docupilot/shared';
import { verifyTurnstile } from '../auth/turnstile';
import { runBatch } from '../db/batch';
import {
  documentHashes,
  documents,
  documentVersions,
  folders,
  uploads,
  workspaces,
} from '../db/schema';
import { AppError, notFound } from '../errors';
import { auditEntry, clientIp, parseBody } from '../http';
import { requireAuth } from '../middleware/auth';
import { requireWorkspacePermission } from '../middleware/workspace';
import { loadQuotas } from '../quotas';
import type { AppVariables, Db } from '../types';

export const uploadRoutes = new Hono<{ Variables: AppVariables }>();
uploadRoutes.use('*', requireAuth);

const HEAD_BYTES = 4096;
const TAIL_BYTES = 65536;
const createSchema = uploadRequestSchema.omit({ workspaceId: true });

const FILE_ERROR_STATUS: Record<string, number> = {
  FILE_TYPE_NOT_ALLOWED: 415,
  FILE_TOO_LARGE: 413,
  FILE_CONTENT_MISMATCH: 422,
};

async function assertQuota(
  db: Db,
  quotas: Quotas,
  workspaceId: string,
  size: number,
): Promise<void> {
  const ws = (
    await db
      .select({ used: workspaces.storageBytesUsed, docs: workspaces.documentCount })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1)
  )[0];
  if (!ws) throw notFound();
  const total = (
    await db
      .select({ total: sql<number>`coalesce(sum(${workspaces.storageBytesUsed}), 0)` })
      .from(workspaces)
  )[0]?.total;
  const exceeded =
    size > quotas.maxFileBytes ||
    ws.used + size > quotas.storageBytesPerWorkspace ||
    ws.docs + 1 > quotas.documentsPerWorkspace ||
    Number(total ?? 0) + size > quotas.storageBytesGlobal;
  if (exceeded) {
    throw new AppError(
      size > quotas.maxFileBytes ? 'FILE_TOO_LARGE' : 'QUOTA_EXCEEDED',
      size > quotas.maxFileBytes ? 413 : 429,
      'Quota do plano gratuito excedida.',
    );
  }
}

uploadRoutes.post('/:workspaceId/uploads', requireWorkspacePermission('edit'), async (c) => {
  const { db, storage, config } = c.get('deps');
  const { workspaceId } = c.get('member');
  const user = c.get('user');
  const input = await parseBody(c, createSchema);
  await verifyTurnstile(config, input.turnstileToken, clientIp(c));
  if (!storage) {
    throw new AppError('STORAGE_NOT_CONFIGURED', 503, 'Armazenamento de arquivos não configurado.');
  }

  const quotas = await loadQuotas(db);
  await assertQuota(db, quotas, workspaceId, input.size);

  if (input.folderId) {
    const folder = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, input.folderId), eq(folders.workspaceId, workspaceId)))
      .limit(1);
    if (folder.length === 0) throw notFound();
  }

  const uploadId = crypto.randomUUID();
  const storageKey = `ws/${workspaceId}/${uploadId}`;
  const expiresAt = Date.now() + UPLOAD_URL_TTL_SECONDS * 1000;
  const signed = await storage.createUploadUrl({
    key: storageKey,
    contentType: input.mime,
    sha256Hex: input.sha256,
    expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
  });

  await runBatch(db, [
    db.insert(uploads).values({
      id: uploadId,
      workspaceId,
      folderId: input.folderId ?? null,
      userId: user.id,
      fileName: input.fileName,
      declaredMime: input.mime,
      declaredSize: input.size,
      sha256: input.sha256,
      storageKey,
      expiresAt,
    }),
    // A URL assinada nunca é registrada; só metadados.
    auditEntry(db, {
      userId: user.id,
      workspaceId,
      action: 'upload.requested',
      targetType: 'upload',
      targetId: uploadId,
      meta: { size: input.size, mime: input.mime },
    }),
  ]);

  return c.json(
    { uploadId, url: signed.url, method: signed.method, headers: signed.headers, expiresAt },
    201,
  );
});

uploadRoutes.post(
  '/:workspaceId/uploads/:uploadId/complete',
  requireWorkspacePermission('edit'),
  async (c) => {
    const { db, storage } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    if (!storage) {
      throw new AppError(
        'STORAGE_NOT_CONFIGURED',
        503,
        'Armazenamento de arquivos não configurado.',
      );
    }

    const upload = (
      await db
        .select()
        .from(uploads)
        .where(
          and(
            eq(uploads.id, c.req.param('uploadId')),
            eq(uploads.workspaceId, workspaceId),
            eq(uploads.userId, user.id),
          ),
        )
        .limit(1)
    )[0];
    if (!upload) throw notFound();
    if (upload.status !== 'pending') throw new AppError('CONFLICT', 409, 'Upload já finalizado.');

    const reject = async (code: ErrorCode, reason: string, status: number): Promise<never> => {
      await storage.delete(upload.storageKey);
      await runBatch(db, [
        db
          .update(uploads)
          .set({ status: 'rejected', rejectReason: reason })
          .where(eq(uploads.id, upload.id)),
        auditEntry(db, {
          userId: user.id,
          workspaceId,
          action: 'upload.rejected',
          targetType: 'upload',
          targetId: upload.id,
          meta: { reason },
        }),
      ]);
      throw new AppError(code, status, 'Arquivo recusado e removido.');
    };

    if (Date.now() > upload.expiresAt) {
      return reject('CONFLICT', 'expired', 409);
    }

    const head = await storage.head(upload.storageKey);
    if (!head) throw new AppError('CONFLICT', 409, 'O arquivo ainda não foi enviado.');
    if (head.size !== upload.declaredSize) {
      return reject('FILE_CONTENT_MISMATCH', 'size_mismatch', 422);
    }

    const quotas = await loadQuotas(db);
    const headBytes = await storage.readRange(
      upload.storageKey,
      0,
      Math.min(HEAD_BYTES, head.size),
    );
    const tailLen = Math.min(TAIL_BYTES, head.size);
    const tailBytes = await storage.readRange(upload.storageKey, head.size - tailLen, tailLen);
    const check = validateUpload({
      declaredMime: upload.declaredMime,
      size: head.size,
      maxBytes: quotas.maxFileBytes,
      head: headBytes,
      tail: tailBytes,
    });
    if (!check.ok)
      return reject(check.code, check.code.toLowerCase(), FILE_ERROR_STATUS[check.code] ?? 422);

    await assertQuota(db, quotas, workspaceId, head.size);

    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    await runBatch(db, [
      db.insert(documents).values({
        id: documentId,
        workspaceId,
        folderId: upload.folderId,
        name: upload.fileName,
        mime: check.mime,
        status: 'needs_text',
        currentVersionId: versionId,
        createdBy: user.id,
      }),
      db.insert(documentVersions).values({
        id: versionId,
        documentId,
        workspaceId,
        versionNumber: 1,
        storageKey: upload.storageKey,
        sizeBytes: head.size,
        mime: check.mime,
        sha256: upload.sha256,
        createdBy: user.id,
      }),
      db.insert(documentHashes).values({
        workspaceId,
        documentVersionId: versionId,
        sha256: upload.sha256,
        verifiedByStorage: storage.verifiesChecksumOnUpload,
      }),
      db
        .update(workspaces)
        .set({
          storageBytesUsed: sql`${workspaces.storageBytesUsed} + ${head.size}`,
          documentCount: sql`${workspaces.documentCount} + 1`,
        })
        .where(eq(workspaces.id, workspaceId)),
      db.update(uploads).set({ status: 'completed' }).where(eq(uploads.id, upload.id)),
      auditEntry(db, {
        userId: user.id,
        workspaceId,
        action: 'upload.completed',
        targetType: 'document',
        targetId: documentId,
        meta: { size: head.size, mime: check.mime },
      }),
    ]);

    return c.json(
      {
        document: { id: documentId, name: upload.fileName, mime: check.mime, status: 'needs_text' },
        versionId,
      },
      201,
    );
  },
);
