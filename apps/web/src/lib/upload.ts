import { api, ApiError } from './api';
import { sha256Hex } from './hash';
import { guessMime } from './mime';

export type UploadStep = 'hashing' | 'uploading' | 'validating';

interface UploadTicket {
  uploadId: string;
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/** Fluxo: hash local → URL assinada → PUT direto ao armazenamento → validação no servidor. */
export async function uploadFile(
  workspaceId: string,
  file: File,
  onStep: (step: UploadStep) => void,
  turnstileToken?: string,
): Promise<void> {
  onStep('hashing');
  const sha256 = await sha256Hex(file);

  const ticket = await api<UploadTicket>(`/workspaces/${workspaceId}/uploads`, {
    method: 'POST',
    body: { fileName: file.name, mime: guessMime(file), size: file.size, sha256, turnstileToken },
  });

  onStep('uploading');
  let put: Response;
  try {
    put = await fetch(ticket.url, { method: ticket.method, headers: ticket.headers, body: file });
  } catch {
    throw new ApiError('NETWORK', 0);
  }
  // O armazenamento rejeita o PUT quando o SHA-256 não confere com o declarado.
  if (!put.ok)
    throw new ApiError(put.status === 400 ? 'FILE_CONTENT_MISMATCH' : 'INTERNAL', put.status);

  onStep('validating');
  await api(`/workspaces/${workspaceId}/uploads/${ticket.uploadId}/complete`, { method: 'POST' });
}
