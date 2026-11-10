import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  detectTextGarbage,
  documentPatchSchema,
  DOWNLOAD_URL_TTL_SECONDS,
  extractionCompleteSchema,
  MAX_CHARS_PER_REQUEST,
  MAX_PAGES_PER_REQUEST,
  pagesUploadSchema,
  sanitizeText,
} from '@docupilot/shared';
import { runBatch } from '../db/batch';
import {
  documentHashes,
  documentMetadata,
  documentPages,
  documents,
  documentVersions,
  folders,
  usageRecords,
  workspaces,
} from '../db/schema';
import { AppError, notFound } from '../errors';
import { auditEntry, parseBody } from '../http';
import { requireAuth } from '../middleware/auth';
import { requireWorkspacePermission } from '../middleware/workspace';
import { loadQuotas } from '../quotas';
import type { AppVariables, Db } from '../types';
import { hasActiveConsent } from './consents';

export const documentRoutes = new Hono<{ Variables: AppVariables }>();
documentRoutes.use('*', requireAuth);

const monthPeriod = () => new Date().toISOString().slice(0, 7);

async function loadDocument(db: Db, workspaceId: string, documentId: string) {
  const doc = (
    await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.workspaceId, workspaceId)))
      .limit(1)
  )[0];
  if (!doc) throw notFound();
  return doc;
}

async function loadVersion(db: Db, workspaceId: string, documentId: string, versionId: string) {
  const v = (
    await db
      .select()
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.id, versionId),
          eq(documentVersions.documentId, documentId),
          eq(documentVersions.workspaceId, workspaceId),
        ),
      )
      .limit(1)
  )[0];
  if (!v) throw notFound();
  return v;
}

async function monthlyExtractions(db: Db, workspaceId: string): Promise<number> {
  const row = (
    await db
      .select({ amount: usageRecords.amount })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.workspaceId, workspaceId),
          eq(usageRecords.metric, 'extractions'),
          eq(usageRecords.period, monthPeriod()),
        ),
      )
      .limit(1)
  )[0];
  return row?.amount ?? 0;
}

// ---------- listagem e detalhe ----------

documentRoutes.get('/:workspaceId/documents', requireWorkspacePermission('read'), async (c) => {
  const { db } = c.get('deps');
  const { workspaceId } = c.get('member');
  const folder = c.req.query('folderId');
  const where =
    !folder || folder === 'all'
      ? eq(documents.workspaceId, workspaceId)
      : and(
          eq(documents.workspaceId, workspaceId),
          folder === 'root' ? isNull(documents.folderId) : eq(documents.folderId, folder),
        );
  const rows = await db
    .select({
      id: documents.id,
      name: documents.name,
      mime: documents.mime,
      status: documents.status,
      folderId: documents.folderId,
      createdAt: documents.createdAt,
      updatedAt: documents.updatedAt,
      sizeBytes: documentVersions.sizeBytes,
    })
    .from(documents)
    .leftJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
    .where(where)
    .orderBy(desc(documents.updatedAt))
    .limit(200);
  return c.json({ documents: rows });
});

documentRoutes.get(
  '/:workspaceId/documents/:documentId',
  requireWorkspacePermission('read'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const doc = await loadDocument(db, workspaceId, c.req.param('documentId'));
    const versions = await db
      .select({
        id: documentVersions.id,
        versionNumber: documentVersions.versionNumber,
        sizeBytes: documentVersions.sizeBytes,
        mime: documentVersions.mime,
        sha256: documentVersions.sha256,
        createdAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, doc.id))
      .orderBy(desc(documentVersions.versionNumber))
      .limit(50);
    const metadata = (
      await db
        .select({
          language: documentMetadata.language,
          pageCount: documentMetadata.pageCount,
          pageKind: documentMetadata.pageKind,
          extractedBy: documentMetadata.extractedBy,
          textCharCount: documentMetadata.textCharCount,
        })
        .from(documentMetadata)
        .where(eq(documentMetadata.documentId, doc.id))
        .limit(1)
    )[0];
    const pageStats = doc.currentVersionId
      ? (
          await db
            .select({
              n: sql<number>`count(*)`,
              last: sql<number>`coalesce(max(${documentPages.pageNumber}), 0)`,
            })
            .from(documentPages)
            .where(eq(documentPages.versionId, doc.currentVersionId))
        )[0]
      : undefined;
    const pagesStored = Number(pageStats?.n ?? 0);
    const lastStoredPage = Number(pageStats?.last ?? 0);
    return c.json({
      pagesStored,
      lastStoredPage,
      document: {
        id: doc.id,
        name: doc.name,
        mime: doc.mime,
        status: doc.status,
        folderId: doc.folderId,
        currentVersionId: doc.currentVersionId,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
      versions,
      metadata: metadata ?? null,
    });
  },
);

documentRoutes.patch(
  '/:workspaceId/documents/:documentId',
  requireWorkspacePermission('edit'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    const input = await parseBody(c, documentPatchSchema);
    const doc = await loadDocument(db, workspaceId, c.req.param('documentId'));
    if (input.folderId) {
      const f = await db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.id, input.folderId), eq(folders.workspaceId, workspaceId)))
        .limit(1);
      if (f.length === 0) throw notFound();
    }
    const name = input.name ?? doc.name;
    const folderId = input.folderId === undefined ? doc.folderId : input.folderId;
    await runBatch(db, [
      db
        .update(documents)
        .set({ name, folderId, updatedAt: Date.now() })
        .where(eq(documents.id, doc.id)),
      auditEntry(db, {
        userId: user.id,
        workspaceId,
        action: 'document.updated',
        targetType: 'document',
        targetId: doc.id,
      }),
    ]);
    return c.json({ document: { id: doc.id, name, folderId } });
  },
);

// ---------- exclusão ----------

documentRoutes.delete(
  '/:workspaceId/documents/:documentId',
  requireWorkspacePermission('delete'),
  async (c) => {
    const { db, storage } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    const doc = await loadDocument(db, workspaceId, c.req.param('documentId'));
    const versions = await db
      .select({
        id: documentVersions.id,
        storageKey: documentVersions.storageKey,
        sizeBytes: documentVersions.sizeBytes,
      })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, doc.id));
    const bytes = versions.reduce((n, v) => n + v.sizeBytes, 0);

    // Ordem importa: o texto é descontado e as páginas removidas antes do documento, para os
    // gatilhos do índice FTS5 rodarem e o contador de texto do workspace ficar correto.
    await runBatch(db, [
      db
        .update(workspaces)
        .set({
          storageBytesUsed: sql`max(0, ${workspaces.storageBytesUsed} - ${bytes})`,
          documentCount: sql`max(0, ${workspaces.documentCount} - 1)`,
          textCharsUsed: sql`max(0, ${workspaces.textCharsUsed} - coalesce((select sum(char_count) from document_pages where document_id = ${doc.id}), 0))`,
        })
        .where(eq(workspaces.id, workspaceId)),
      db.delete(documentPages).where(eq(documentPages.documentId, doc.id)),
      db.delete(documentHashes).where(
        inArray(
          documentHashes.documentVersionId,
          versions.map((v) => v.id),
        ),
      ),
      db.delete(documentMetadata).where(eq(documentMetadata.documentId, doc.id)),
      db.delete(documentVersions).where(eq(documentVersions.documentId, doc.id)),
      db.delete(documents).where(eq(documents.id, doc.id)),
      auditEntry(db, {
        userId: user.id,
        workspaceId,
        action: 'document.deleted',
        targetType: 'document',
        targetId: doc.id,
        meta: { versions: versions.length, bytes },
      }),
    ]);

    // Banco primeiro, objetos depois: uma falha aqui deixa objetos órfãos (custo), nunca
    // documentos apontando para arquivos inexistentes.
    let storageCleaned = true;
    if (storage && versions.length > 0) {
      try {
        await storage.deleteMany(versions.map((v) => v.storageKey));
      } catch {
        storageCleaned = false;
        console.error('storage cleanup failed');
      }
    }
    return c.json({ ok: true, storageCleaned });
  },
);

// ---------- download e páginas ----------

documentRoutes.get(
  '/:workspaceId/documents/:documentId/download-url',
  requireWorkspacePermission('read'),
  async (c) => {
    const { db, storage } = c.get('deps');
    const { workspaceId } = c.get('member');
    if (!storage) {
      throw new AppError(
        'STORAGE_NOT_CONFIGURED',
        503,
        'Armazenamento de arquivos não configurado.',
      );
    }
    const doc = await loadDocument(db, workspaceId, c.req.param('documentId'));
    const versionId = c.req.query('versionId') ?? doc.currentVersionId;
    if (!versionId) throw notFound();
    const version = await loadVersion(db, workspaceId, doc.id, versionId);
    const url = await storage.createDownloadUrl(version.storageKey, DOWNLOAD_URL_TTL_SECONDS);
    return c.json({
      url,
      fileName: doc.name,
      mime: version.mime,
      sizeBytes: version.sizeBytes,
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
    });
  },
);

documentRoutes.get(
  '/:workspaceId/documents/:documentId/pages',
  requireWorkspacePermission('read'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const doc = await loadDocument(db, workspaceId, c.req.param('documentId'));
    const versionId = c.req.query('versionId') ?? doc.currentVersionId;
    if (!versionId) return c.json({ pages: [], hasMore: false });
    await loadVersion(db, workspaceId, doc.id, versionId);
    const from = Math.max(1, Number(c.req.query('from') ?? 1) || 1);
    const rows = await db
      .select({ pageNumber: documentPages.pageNumber, text: documentPages.text })
      .from(documentPages)
      .where(
        and(eq(documentPages.versionId, versionId), sql`${documentPages.pageNumber} >= ${from}`),
      )
      .orderBy(asc(documentPages.pageNumber))
      .limit(MAX_PAGES_PER_REQUEST + 1);
    return c.json({
      pages: rows.slice(0, MAX_PAGES_PER_REQUEST),
      hasMore: rows.length > MAX_PAGES_PER_REQUEST,
    });
  },
);

// ---------- versões ----------

documentRoutes.post(
  '/:workspaceId/documents/:documentId/versions/:versionId/current',
  requireWorkspacePermission('edit'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    const doc = await loadDocument(db, workspaceId, c.req.param('documentId'));
    const version = await loadVersion(db, workspaceId, doc.id, c.req.param('versionId'));
    if (version.id === doc.currentVersionId) return c.json({ status: doc.status });

    const stats = (
      await db
        .select({
          pages: sql<number>`count(*)`,
          chars: sql<number>`coalesce(sum(${documentPages.charCount}), 0)`,
        })
        .from(documentPages)
        .where(eq(documentPages.versionId, version.id))
    )[0];
    const pages = Number(stats?.pages ?? 0);
    const status = pages > 0 ? 'extracted' : 'needs_text';
    const queries: unknown[] = [
      db
        .update(documents)
        .set({ currentVersionId: version.id, mime: version.mime, status, updatedAt: Date.now() })
        .where(eq(documents.id, doc.id)),
    ];
    if (pages > 0) {
      queries.push(
        db
          .insert(documentMetadata)
          .values({
            documentId: doc.id,
            pageCount: pages,
            textCharCount: Number(stats?.chars ?? 0),
          })
          .onConflictDoUpdate({
            target: documentMetadata.documentId,
            set: {
              pageCount: pages,
              textCharCount: Number(stats?.chars ?? 0),
              updatedAt: Date.now(),
            },
          }),
      );
    } else {
      queries.push(db.delete(documentMetadata).where(eq(documentMetadata.documentId, doc.id)));
    }
    queries.push(
      auditEntry(db, {
        userId: user.id,
        workspaceId,
        action: 'document.version_restored',
        targetType: 'document',
        targetId: doc.id,
        meta: { versionNumber: version.versionNumber },
      }),
    );
    await runBatch(db, queries);
    return c.json({ status });
  },
);

documentRoutes.delete(
  '/:workspaceId/documents/:documentId/versions/:versionId',
  requireWorkspacePermission('delete'),
  async (c) => {
    const { db, storage } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    const doc = await loadDocument(db, workspaceId, c.req.param('documentId'));
    const version = await loadVersion(db, workspaceId, doc.id, c.req.param('versionId'));
    if (version.id === doc.currentVersionId) {
      throw new AppError('CONFLICT', 409, 'A versão atual não pode ser excluída.');
    }
    await runBatch(db, [
      db
        .update(workspaces)
        .set({
          storageBytesUsed: sql`max(0, ${workspaces.storageBytesUsed} - ${version.sizeBytes})`,
          textCharsUsed: sql`max(0, ${workspaces.textCharsUsed} - coalesce((select sum(char_count) from document_pages where version_id = ${version.id}), 0))`,
        })
        .where(eq(workspaces.id, workspaceId)),
      db.delete(documentPages).where(eq(documentPages.versionId, version.id)),
      db.delete(documentHashes).where(eq(documentHashes.documentVersionId, version.id)),
      db.delete(documentVersions).where(eq(documentVersions.id, version.id)),
      auditEntry(db, {
        userId: user.id,
        workspaceId,
        action: 'document.version_deleted',
        targetType: 'document',
        targetId: doc.id,
        meta: { versionNumber: version.versionNumber },
      }),
    ]);
    if (storage) {
      try {
        await storage.delete(version.storageKey);
      } catch {
        console.error('storage cleanup failed');
      }
    }
    return c.json({ ok: true });
  },
);

// ---------- extração (texto vindo do navegador) ----------

documentRoutes.put(
  '/:workspaceId/documents/:documentId/versions/:versionId/pages',
  requireWorkspacePermission('edit'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    const input = await parseBody(c, pagesUploadSchema);
    const doc = await loadDocument(db, workspaceId, c.req.param('documentId'));
    const version = await loadVersion(db, workspaceId, doc.id, c.req.param('versionId'));
    if (version.id !== doc.currentVersionId) {
      throw new AppError('CONFLICT', 409, 'Só a versão atual recebe texto extraído.');
    }
    if (
      input.extractedBy === 'client_ocr' &&
      !(await hasActiveConsent(db, user.id, 'browser_ocr'))
    ) {
      throw new AppError('CONSENT_REQUIRED', 403, 'Consentimento para OCR no navegador ausente.');
    }

    const numbers = input.pages.map((p) => p.pageNumber);
    if (new Set(numbers).size !== numbers.length) {
      throw new AppError('VALIDATION_ERROR', 400, 'Números de página repetidos no lote.');
    }
    // O servidor nunca confia no texto: higieniza e confere o tamanho total.
    const pages = input.pages.map((p) => {
      const text = sanitizeText(p.text);
      return { pageNumber: p.pageNumber, text, charCount: text.length };
    });
    const nonEmpty = pages.filter((p) => p.text.trim().length > 0);
    const newChars = nonEmpty.reduce((n, p) => n + p.charCount, 0);
    if (newChars > MAX_CHARS_PER_REQUEST) {
      throw new AppError('VALIDATION_ERROR', 400, 'Lote de texto grande demais.');
    }
    if (input.extractedBy === 'client' && newChars >= 50) {
      const verdict = detectTextGarbage(nonEmpty.map((p) => p.text).join('\n'));
      // Só os sinais inequívocos são recusados aqui; o limiar subjetivo fica no cliente.
      if (verdict.reason === 'replacement_chars' || verdict.reason === 'private_use') {
        throw new AppError('VALIDATION_ERROR', 400, 'O texto enviado parece corrompido.');
      }
    }

    const quotas = await loadQuotas(db);
    if ((await monthlyExtractions(db, workspaceId)) >= quotas.extractionsPerMonth) {
      throw new AppError('QUOTA_EXCEEDED', 429, 'Limite mensal de extrações atingido.');
    }
    const ws = (
      await db
        .select({ used: workspaces.textCharsUsed })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId))
        .limit(1)
    )[0];
    if (!ws) throw notFound();
    const oldChars = Number(
      (
        await db
          .select({ n: sql<number>`coalesce(sum(${documentPages.charCount}), 0)` })
          .from(documentPages)
          .where(
            and(
              eq(documentPages.versionId, version.id),
              inArray(documentPages.pageNumber, numbers),
            ),
          )
      )[0]?.n ?? 0,
    );
    if (ws.used - oldChars + newChars > quotas.textCharsPerWorkspace) {
      throw new AppError('QUOTA_EXCEEDED', 429, 'Limite de texto indexado do workspace atingido.');
    }

    const queries: unknown[] = [
      db
        .update(workspaces)
        .set({
          textCharsUsed: sql`max(0, ${workspaces.textCharsUsed} - ${oldChars}) + ${newChars}`,
        })
        .where(eq(workspaces.id, workspaceId)),
      db
        .delete(documentPages)
        .where(
          and(eq(documentPages.versionId, version.id), inArray(documentPages.pageNumber, numbers)),
        ),
    ];
    if (nonEmpty.length > 0) {
      queries.push(
        db.insert(documentPages).values(
          nonEmpty.map((p) => ({
            versionId: version.id,
            documentId: doc.id,
            workspaceId,
            pageNumber: p.pageNumber,
            text: p.text,
            charCount: p.charCount,
          })),
        ),
      );
    }
    await runBatch(db, queries);
    return c.json({ stored: nonEmpty.length });
  },
);

documentRoutes.post(
  '/:workspaceId/documents/:documentId/versions/:versionId/extraction/complete',
  requireWorkspacePermission('edit'),
  async (c) => {
    const { db } = c.get('deps');
    const { workspaceId } = c.get('member');
    const user = c.get('user');
    const input = await parseBody(c, extractionCompleteSchema);
    const doc = await loadDocument(db, workspaceId, c.req.param('documentId'));
    const version = await loadVersion(db, workspaceId, doc.id, c.req.param('versionId'));
    if (version.id !== doc.currentVersionId) {
      throw new AppError('CONFLICT', 409, 'Só a versão atual pode ser finalizada.');
    }
    const now = Date.now();

    if (input.status !== 'extracted') {
      // Sem texto aproveitável: descarta páginas parciais e registra o estado.
      await runBatch(db, [
        db
          .update(workspaces)
          .set({
            textCharsUsed: sql`max(0, ${workspaces.textCharsUsed} - coalesce((select sum(char_count) from document_pages where version_id = ${version.id}), 0))`,
          })
          .where(eq(workspaces.id, workspaceId)),
        db.delete(documentPages).where(eq(documentPages.versionId, version.id)),
        db
          .update(documents)
          .set({ status: input.status, updatedAt: now })
          .where(eq(documents.id, doc.id)),
        db
          .insert(documentMetadata)
          .values({
            documentId: doc.id,
            pageCount: input.pageCount ?? null,
            pageKind: input.pageKind,
            extractedBy: null,
            textCharCount: 0,
          })
          .onConflictDoUpdate({
            target: documentMetadata.documentId,
            set: {
              pageCount: input.pageCount ?? null,
              pageKind: input.pageKind,
              extractedBy: null,
              textCharCount: 0,
              updatedAt: now,
            },
          }),
        auditEntry(db, {
          userId: user.id,
          workspaceId,
          action: `extraction.${input.status}`,
          targetType: 'document',
          targetId: doc.id,
        }),
      ]);
      return c.json({ status: input.status });
    }

    if (
      input.extractedBy === 'client_ocr' &&
      !(await hasActiveConsent(db, user.id, 'browser_ocr'))
    ) {
      throw new AppError('CONSENT_REQUIRED', 403, 'Consentimento para OCR no navegador ausente.');
    }
    const stats = (
      await db
        .select({
          pages: sql<number>`count(*)`,
          chars: sql<number>`coalesce(sum(${documentPages.charCount}), 0)`,
        })
        .from(documentPages)
        .where(eq(documentPages.versionId, version.id))
    )[0];
    const stored = Number(stats?.pages ?? 0);
    const chars = Number(stats?.chars ?? 0);
    if (stored === 0) {
      throw new AppError('VALIDATION_ERROR', 400, 'Nenhum texto foi enviado para esta versão.');
    }
    const pageCount = Math.max(input.pageCount ?? 0, stored);
    await runBatch(db, [
      db
        .update(documents)
        .set({ status: 'extracted', updatedAt: now })
        .where(eq(documents.id, doc.id)),
      db
        .insert(documentMetadata)
        .values({
          documentId: doc.id,
          language: input.language ?? null,
          pageCount,
          pageKind: input.pageKind,
          extractedBy: input.extractedBy,
          textCharCount: chars,
        })
        .onConflictDoUpdate({
          target: documentMetadata.documentId,
          set: {
            language: input.language ?? null,
            pageCount,
            pageKind: input.pageKind,
            extractedBy: input.extractedBy,
            textCharCount: chars,
            updatedAt: now,
          },
        }),
      db
        .insert(usageRecords)
        .values({ workspaceId, metric: 'extractions', period: monthPeriod(), amount: 1 })
        .onConflictDoUpdate({
          target: [usageRecords.workspaceId, usageRecords.metric, usageRecords.period],
          set: { amount: sql`${usageRecords.amount} + 1` },
        }),
      auditEntry(db, {
        userId: user.id,
        workspaceId,
        action: 'extraction.completed',
        targetType: 'document',
        targetId: doc.id,
        meta: { pages: stored, chars, by: input.extractedBy },
      }),
    ]);
    return c.json({ status: 'extracted', pageCount, textCharCount: chars });
  },
);
