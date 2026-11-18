/** Tipos e consultas da Fase 6: documentos criados, workflows, aprovações e notificações. */
import { useQuery } from '@tanstack/react-query';
import type { DocRoot, ExecutionStatus, StepLogEntry, WorkflowStep } from '@docupilot/shared';
import { api } from './api';
import { useMe } from './queries';

export interface GeneratedRow {
  id: string;
  title: string;
  version: number;
  updatedAt: number;
}
export interface GeneratedDetail extends GeneratedRow {
  content: DocRoot;
  placeholders: string[];
}
export interface WorkflowRow {
  id: string;
  name: string;
  steps: number;
  updatedAt: number;
}
export interface WorkflowDetail {
  id: string;
  name: string;
  steps: WorkflowStep[];
  inputs: Array<'primary' | 'secondary'>;
}
export interface ExecutionView {
  id: string;
  workflowId: string;
  workflowName?: string;
  status: ExecutionStatus;
  startedAt: number;
  finishedAt: number | null;
  startedBy: string | null;
  usedMs: number;
  steps: Array<{ position: number; kind: string }>;
  log: StepLogEntry[];
}
export interface NotificationRow {
  id: string;
  kind: string;
  data: { executionId?: string; workflowId?: string; workflowName?: string } | null;
  readAt: number | null;
  createdAt: number;
}

export function useWorkspace() {
  const me = useMe();
  const ws = me.data?.workspaces[0];
  return { id: ws?.id, role: ws?.role, personal: ws?.isPersonal ?? true };
}

export const useGenerated = (ws: string | undefined) =>
  useQuery({
    queryKey: ['generated', ws],
    queryFn: () => api<{ documents: GeneratedRow[]; max: number }>(`/workspaces/${ws}/generated`),
    enabled: Boolean(ws),
  });
export const useGeneratedDoc = (ws: string | undefined, id: string | undefined) =>
  useQuery({
    queryKey: ['generated', ws, id],
    queryFn: () => api<GeneratedDetail>(`/workspaces/${ws}/generated/${id}`),
    enabled: Boolean(ws && id),
    // O editor mantém o próprio estado: não recarrega em segundo plano por cima do que a pessoa escreveu.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

export const useWorkflows = (ws: string | undefined) =>
  useQuery({
    queryKey: ['workflows', ws],
    queryFn: () => api<{ workflows: WorkflowRow[]; max: number }>(`/workspaces/${ws}/workflows`),
    enabled: Boolean(ws),
  });
export const useWorkflow = (ws: string | undefined, id: string | undefined) =>
  useQuery({
    queryKey: ['workflows', ws, id],
    queryFn: () => api<WorkflowDetail>(`/workspaces/${ws}/workflows/${id}`),
    enabled: Boolean(ws && id),
  });
export const useExecution = (ws: string | undefined, id: string | undefined) =>
  useQuery({
    queryKey: ['execution', ws, id],
    queryFn: () => api<ExecutionView>(`/workspaces/${ws}/workflow-executions/${id}`),
    enabled: Boolean(ws && id),
  });
export const useExecutions = (ws: string | undefined, workflowId: string | undefined) =>
  useQuery({
    queryKey: ['executions', ws, workflowId],
    queryFn: () =>
      api<{ executions: ExecutionView[] }>(`/workspaces/${ws}/workflows/${workflowId}/executions`),
    enabled: Boolean(ws && workflowId),
  });

export const useNotifications = (enabled = true) =>
  useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ notifications: NotificationRow[]; unread: number }>('/me/notifications'),
    enabled,
    // Só no app aberto: sem Web Push (notificações são dentro do app).
    refetchInterval: 60_000,
  });

export const canApproveRole = (role?: string) =>
  ['owner', 'admin', 'manager', 'approver'].includes(role ?? '');
