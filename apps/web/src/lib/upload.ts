import { api, ApiError } from './api';
import { extractFromBlob } from './extract';
import { submitExtraction } from './extract/submit';
import { sha256Hex } from './hash';
import { guessMime } from './mime';

export type UploadStep = 'hashing' | 'checking' | 'uploading' | 'validating' | 'extracting';

interface UploadTicket {
  uploadId: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

export interface Precheck {
  sha256: string;
  duplicate: { documentId: string; name: string } | null;
  sameName: { documentId: string; name: string } | null;
}

/** Calcula o SHA-256 localmente e pergunta ao servidor se já existe o mesmo arquivo ou o mesmo nome. */
export async function precheckUpload(
  workspaceId: string,
  file: File,
  folderId: string | null,
): Promise<Precheck> {
  const sha256 = await sha256Hex(file);
  const res = await api<Pick<Precheck, 'duplicate' | 'sameName'>>(
    `/workspaces/${workspaceId}/uploads/precheck`,
    { method: 'POST', body: { fileName: file.name, folderId, sha256 } },
  );
  return { sha256, ...res };
}

export interface UploadOptions {
  folderId?: string | null;
  /** Envia como nova versão deste documento. */
  documentId?: string;
  allowDuplicate?: boolean;
  sha256?: string;
  turnstileToken?: string;
  onStep: (step: UploadStep) => void;
}

export interface UploadedDocument {
  documentId: string;
  versionId: string;
  versionNumber: number;
  mime: string;
  status: string;
}

/**
 * Fluxo: hash local → URL assinada → PUT direto ao armazenamento → validação no servidor →
 * extração de texto no navegador (o servidor nunca lê PDFs).
 */
export async function uploadFile(
  workspaceId: string,
  file: File,
  opts: UploadOptions,
): Promise<UploadedDocument> {
  opts.onStep('hashing');
  const sha256 = opts.sha256 ?? (await sha256Hex(file));
  const mime = guessMime(file);

  const ticket = await api<UploadTicket>(`/workspaces/${workspaceId}/uploads`, {
    method: 'POST',
    body: {
      fileName: file.name,
      mime,
      size: file.size,
      sha256,
      folderId: opts.folderId ?? null,
      documentId: opts.documentId,
      allowDuplicate: opts.allowDuplicate,
      turnstileToken: opts.turnstileToken,
    },
  });

  opts.onStep('uploading');
  let put: Response;
  try {
    put = await fetch(ticket.url, { method: ticket.method, headers: ticket.headers, body: file });
  } catch {
    throw new ApiError('NETWORK', 0);
  }
  // O armazenamento rejeita o PUT quando o SHA-256 não confere com o declarado.
  if (!put.ok)
    throw new ApiError(put.status === 400 ? 'FILE_CONTENT_MISMATCH' : 'INTERNAL', put.status);

  opts.onStep('validating');
  const done = await api<{
    document: { id: string; mime: string; status: string };
    versionId: string;
    versionNumber: number;
  }>(`/workspaces/${workspaceId}/uploads/${ticket.uploadId}/complete`, { method: 'POST' });

  const uploaded: UploadedDocument = {
    documentId: done.document.id,
    versionId: done.versionId,
    versionNumber: done.versionNumber,
    mime: done.document.mime,
    status: done.document.status,
  };

  // O arquivo já está validado e guardado. Se a extração falhar (rede, quota), o documento
  // fica "aguardando extração" e o usuário pode tentar de novo na página do documento.
  opts.onStep('extracting');
  try {
    uploaded.status = await runExtraction(workspaceId, uploaded, file);
  } catch {
    /* mantém needs_text */
  }
  return uploaded;
}

/** Extrai o texto localmente e envia ao servidor. Devolve o estado final do documento. */
export async function runExtraction(
  workspaceId: string,
  doc: Pick<UploadedDocument, 'documentId' | 'versionId' | 'mime'>,
  blob: Blob,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const result = await extractFromBlob(blob, doc.mime);
  return submitExtraction(
    { workspaceId, documentId: doc.documentId, versionId: doc.versionId },
    result,
    'client',
    onProgress,
  );
}
