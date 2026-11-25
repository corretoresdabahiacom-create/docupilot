import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface AdminOverview {
  generatedAt: number;
  totals: {
    activeUsers: number;
    suspendedUsers: number;
    organizations: number;
    workspaces: number;
    documents: number;
    documentsByStatus: Record<string, number>;
  };
  consumption: {
    storageBytes: number;
    storageGlobalQuotaBytes: number;
    textChars: number;
    database: { bytes: number | null; nominalLimitBytes: number; nominalVerified: boolean };
    workers: { measured: boolean };
    objectStorage: { measured: boolean; appTrackedBytes: number };
  };
  jobs: Record<string, number>;
  failures: Record<string, number>;
  reports: { open: number; ownerNotified: number };
  shares: { featureImplemented: boolean; activeLinks: number; expiredLinks: number };
}
export interface AdminUser {
  id: string;
  email: string;
  status: string;
  isPlatformAdmin: boolean;
  createdAt: number;
  workspaces: number;
}
export interface AdminReport {
  id: string;
  targetType: string;
  targetRef: string;
  reason: string;
  status: 'open' | 'owner_notified' | 'dismissed' | 'removed';
  ownerNotifiedAt: number | null;
  removalAfter: number | null;
  createdAt: number;
}
export interface AdminQuotas {
  defaults: Record<string, number>;
  overrides: Record<string, number>;
  effective: Record<string, number>;
}

export const useAdminOverview = () =>
  useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => api<AdminOverview>('/admin/overview'),
  });
export const useAdminUsers = (q: string) =>
  useQuery({
    queryKey: ['admin', 'users', q],
    queryFn: () => api<{ users: AdminUser[] }>(`/admin/users?q=${encodeURIComponent(q)}`),
  });
export const useAdminReports = () =>
  useQuery({
    queryKey: ['admin', 'reports'],
    queryFn: () => api<{ reports: AdminReport[]; graceHours: number }>('/admin/reports'),
  });
export const useAdminFlags = () =>
  useQuery({
    queryKey: ['admin', 'flags'],
    queryFn: () => api<{ flags: { key: string; enabled: boolean }[] }>('/admin/flags'),
  });
export const useAdminQuotas = () =>
  useQuery({ queryKey: ['admin', 'quotas'], queryFn: () => api<AdminQuotas>('/admin/quotas') });
