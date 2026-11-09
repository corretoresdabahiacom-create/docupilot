import { useQuery } from '@tanstack/react-query';
import { api, type DocumentRow, type Health, type Me } from './api';

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/auth/me'), retry: false });
export const useHealth = () =>
  useQuery({ queryKey: ['health'], queryFn: () => api<Health>('/health'), retry: false });
export const useDocuments = (workspaceId: string | undefined) =>
  useQuery({
    queryKey: ['documents', workspaceId],
    queryFn: () => api<{ documents: DocumentRow[] }>(`/workspaces/${workspaceId}/documents`),
    enabled: Boolean(workspaceId),
  });
