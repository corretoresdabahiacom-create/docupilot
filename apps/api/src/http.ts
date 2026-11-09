import type { Context } from 'hono';
import type { ZodType, output } from 'zod';
import { AppError } from './errors';
import { auditLogs } from './db/schema';
import type { AppVariables, Db } from './types';

export async function parseBody<S extends ZodType>(
  c: Context<{ Variables: AppVariables }>,
  schema: S,
): Promise<output<S>> {
  const raw = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Só caminhos e códigos: nunca ecoa valores recebidos (podem ser sensíveis).
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(corpo)'))];
    throw new AppError('VALIDATION_ERROR', 400, `Dados inválidos: ${fields.join(', ')}.`);
  }
  return parsed.data;
}

/** Entrada de auditoria como query (para uso em batch). Apenas metadados. */
export function auditEntry(
  db: Db,
  entry: {
    userId?: string | null;
    workspaceId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    meta?: Record<string, string | number | boolean>;
  },
) {
  return db.insert(auditLogs).values({
    userId: entry.userId ?? null,
    workspaceId: entry.workspaceId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    meta: entry.meta ? JSON.stringify(entry.meta) : null,
  });
}

export function clientIp(c: Context): string | null {
  return c.req.header('cf-connecting-ip') ?? null;
}
