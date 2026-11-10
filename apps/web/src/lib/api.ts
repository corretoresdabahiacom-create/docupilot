export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message?: string,
    public readonly details?: Record<string, string | number | boolean>,
  ) {
    super(message ?? code);
  }
}

const BASE = import.meta.env.VITE_API_URL ?? '';

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'docupilot' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError('NETWORK', 0);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(
      data?.error?.code ?? 'INTERNAL',
      res.status,
      data?.error?.message,
      data?.error?.details,
    );
  }
  return data as T;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  isPersonal: boolean;
  role: string;
}
export interface Me {
  user: { id: string; email: string; displayName: string };
  workspaces: WorkspaceSummary[];
}
export type DocumentStatus = 'needs_text' | 'extracted' | 'needs_ocr' | 'extraction_failed';
export interface DocumentRow {
  id: string;
  name: string;
  mime: string;
  status: DocumentStatus;
  folderId: string | null;
  createdAt: number;
  updatedAt: number;
  sizeBytes: number | null;
}
export interface FolderRow {
  id: string;
  parentId: string | null;
  name: string;
  depth: number;
}
export interface VersionRow {
  id: string;
  versionNumber: number;
  sizeBytes: number;
  mime: string;
  sha256: string;
  createdAt: number;
}
export interface DocumentDetail {
  pagesStored: number;
  lastStoredPage: number;
  document: {
    id: string;
    name: string;
    mime: string;
    status: DocumentStatus;
    folderId: string | null;
    currentVersionId: string | null;
    createdAt: number;
    updatedAt: number;
  };
  versions: VersionRow[];
  metadata: {
    language: string | null;
    pageCount: number | null;
    pageKind: 'page' | 'section';
    extractedBy: 'client' | 'client_ocr' | null;
    textCharCount: number | null;
  } | null;
}
export interface SearchHit {
  documentId: string;
  documentName: string;
  folderId: string | null;
  pageNumber: number;
  pageKind: 'page' | 'section';
  snippet: string;
}
export interface Health {
  status: string;
  storage: { configured: boolean; provider: string | null };
  turnstile: { configured: boolean };
  flags: Record<string, boolean>;
}
