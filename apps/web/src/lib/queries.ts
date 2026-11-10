import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type AnalysisResponse,
  type DocumentDetail,
  type DocumentRow,
  type FolderRow,
  type Health,
  type Me,
  type SearchHit,
} from './api';

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });
export const useHealth = () =>
  useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/health'), retry: false });

export const useFolders = (workspaceId: string | undefined) =>
  useQuery({
    queryKey: ['folders', workspaceId],
    queryFn: () => api<{ folders: FolderRow[] }>(`/workspaces/${workspaceId}/folders`),
    enabled: Boolean(workspaceId),
  });

export const useDocuments = (workspaceId: string | undefined, folderId: string | null = null) =>
  useQuery({
    queryKey: ['documents', workspaceId, folderId ?? 'root'],
    queryFn: () =>
      api<{ documents: DocumentRow[] }>(
        `/workspaces/${workspaceId}/documents?folderId=${folderId ?? 'root'}`,
      ),
    enabled: Boolean(workspaceId),
  });

export const useDocument = (workspaceId: string | undefined, documentId: string | undefined) =>
  useQuery({
    queryKey: ['document', workspaceId, documentId],
    queryFn: () => api<DocumentDetail>(`/workspaces/${workspaceId}/documents/${documentId}`),
    enabled: Boolean(workspaceId && documentId),
  });

export const useAnalysis = (workspaceId: string | undefined, documentId: string | undefined) =>
  useQuery({
    queryKey: ['analysis', workspaceId, documentId],
    queryFn: () =>
      api<AnalysisResponse>(`/workspaces/${workspaceId}/documents/${documentId}/analysis`),
    enabled: Boolean(workspaceId && documentId),
  });

export const useSearch = (workspaceId: string | undefined, q: string, documentId?: string) =>
  useQuery({
    queryKey: ['search', workspaceId, q, documentId ?? null],
    queryFn: () =>
      api<{ mode: 'fts' | 'like'; hasMore: boolean; results: SearchHit[] }>(
        `/workspaces/${workspaceId}/search?q=${encodeURIComponent(q)}${
          documentId ? `&documentId=${documentId}` : ''
        }`,
      ),
    enabled: Boolean(workspaceId) && q.trim().length >= 2,
    retry: false,
  });

export const useOcrConsent = () =>
  useQuery({
    queryKey: ['consents'],
    queryFn: async () => {
      const res = await api<{ consents: { purpose: string }[] }>('/me/consents');
      return res.consents.some((c) => c.purpose === 'browser_ocr');
    },
  });

export function useGrantOcrConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/me/consents', { method: 'POST', body: { purpose: 'browser_ocr' } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consents'] }),
  });
}

export function useRevokeOcrConsent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/me/consents/browser_ocr', { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['consents'] }),
  });
}

/** Papéis com permissão de edição/remoção (espelha a matriz do servidor; o servidor decide). */
export const canEditRole = (role?: string) =>
  ['owner', 'admin', 'manager', 'editor'].includes(role ?? '');
export const canDeleteRole = (role?: string) => ['owner', 'admin', 'manager'].includes(role ?? '');
