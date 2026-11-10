import { api, ApiError } from './api';

export interface DownloadInfo {
  url: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  expiresInSeconds: number;
}

export const getDownloadInfo = (workspaceId: string, documentId: string, versionId?: string) =>
  api<DownloadInfo>(
    `/workspaces/${workspaceId}/documents/${documentId}/download-url${
      versionId ? `?versionId=${versionId}` : ''
    }`,
  );

/** Baixa o arquivo para o navegador (usado na extração/OCR). Exige CORS de GET no bucket. */
export async function fetchDocumentBlob(
  workspaceId: string,
  documentId: string,
  versionId?: string,
): Promise<Blob> {
  const info = await getDownloadInfo(workspaceId, documentId, versionId);
  let res: Response;
  try {
    res = await fetch(info.url);
  } catch {
    throw new ApiError('DOWNLOAD_FAILED', 0);
  }
  if (!res.ok) throw new ApiError('DOWNLOAD_FAILED', res.status);
  return res.blob();
}
