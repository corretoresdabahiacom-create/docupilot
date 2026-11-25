import { eq, inArray, sql } from 'drizzle-orm';
import { runBatch } from './db/batch';
import {
  documentHashes,
  documentMetadata,
  documentPages,
  documents,
  documentVersions,
  workspaces,
} from './db/schema';
import { auditEntry } from './http';
import type { StorageProvider } from './storage/types';
import type { Db } from './types';

/**
 * Exclusão completa de um documento (banco e objetos), usada pela rota do usuário e pela
 * moderação. Ordem importa: o texto é descontado e as páginas removidas antes do documento.
 * Banco primeiro, objetos depois: falha na limpeza deixa objetos órfãos (custo), nunca documentos
 * apontando para arquivos inexistentes.
 */
export async function deleteDocumentCascade(
  db: Db,
  storage: StorageProvider | null,
  doc: { id: string; workspaceId: string },
  audit: { userId: string; action: string; meta?: Record<string, string | number | boolean> },
): Promise<{ storageCleaned: boolean }> {
  const versions = await db
    .select({
      id: documentVersions.id,
      storageKey: documentVersions.storageKey,
      sizeBytes: documentVersions.sizeBytes,
    })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, doc.id));
  const bytes = versions.reduce((n, v) => n + v.sizeBytes, 0);

  await runBatch(db, [
    db
      .update(workspaces)
      .set({
        storageBytesUsed: sql`greatest(0, ${workspaces.storageBytesUsed} - ${bytes})`,
        documentCount: sql`greatest(0, ${workspaces.documentCount} - 1)`,
        textCharsUsed: sql`greatest(0, ${workspaces.textCharsUsed} - coalesce((select sum(char_count) from document_pages where document_id = ${doc.id}), 0))`,
      })
      .where(eq(workspaces.id, doc.workspaceId)),
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
      userId: audit.userId,
      workspaceId: doc.workspaceId,
      action: audit.action,
      targetType: 'document',
      targetId: doc.id,
      meta: { versions: versions.length, bytes, ...audit.meta },
    }),
  ]);

  let storageCleaned = true;
  if (storage && versions.length > 0) {
    try {
      await storage.deleteMany(versions.map((v) => v.storageKey));
    } catch {
      storageCleaned = false;
      console.error('storage cleanup failed');
    }
  }
  return { storageCleaned };
}
