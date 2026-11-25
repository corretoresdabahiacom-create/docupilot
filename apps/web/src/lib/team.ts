import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface MemberRow {
  userId: string;
  role: string;
  displayName: string;
  joinedAt: number;
  isMe: boolean;
  email?: string;
  usedBytes?: number;
  quotaBytes?: number;
  quotaIsDefault?: boolean;
}
export interface InviteRow {
  id: string;
  role: string;
  expiresAt: number;
  usedAt: number | null;
  createdAt: number;
  status: 'pending' | 'used' | 'expired';
}
export interface ActivityEvent {
  id: string;
  action: string;
  createdAt: number;
  displayName: string | null;
  targetType: string | null;
}
export interface FolderGrant {
  userId: string;
  access: 'view' | 'edit';
  displayName: string;
}

const PENDING_KEY = 'docupilot.pendingInvite';
export function rememberInvite(token: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, token);
  } catch {
    /* sem armazenamento: o usuário reabre o link */
  }
}
export function takePendingInvite(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}
export function clearPendingInvite(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignora */
  }
}

export const useMembers = (ws: string | undefined) =>
  useQuery({
    queryKey: ['members', ws],
    queryFn: () => api<{ members: MemberRow[]; maxMembers: number }>(`/workspaces/${ws}/members`),
    enabled: Boolean(ws),
  });

export const useInvites = (ws: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['invites', ws],
    queryFn: () => api<{ invites: InviteRow[] }>(`/workspaces/${ws}/invites`),
    enabled: Boolean(ws) && enabled,
  });

export const useActivity = (ws: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ['activity', ws],
    queryFn: () =>
      api<{ events: ActivityEvent[]; next: number | null }>(`/workspaces/${ws}/activity?limit=20`),
    enabled: Boolean(ws) && enabled,
  });

export const useFolderAccess = (ws: string | undefined, folderId: string) =>
  useQuery({
    queryKey: ['folderAccess', ws, folderId],
    queryFn: () =>
      api<{ restricted: boolean; grants: FolderGrant[] }>(
        `/workspaces/${ws}/folders/${folderId}/access`,
      ),
    enabled: Boolean(ws),
  });
