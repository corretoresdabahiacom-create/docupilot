import { DEFAULT_QUOTAS, type Quotas } from '@docupilot/shared';
import { systemSettings } from './db/schema';
import type { Db } from './types';

/** Quotas efetivas: padrão do código + sobrescritas em system_settings (`quota.<nome>`). */
export async function loadQuotas(db: Db): Promise<Quotas> {
  const quotas: Quotas = { ...DEFAULT_QUOTAS };
  const rows = await db.select().from(systemSettings);
  for (const row of rows) {
    if (!row.key.startsWith('quota.')) continue;
    const name = row.key.slice('quota.'.length) as keyof Quotas;
    const value = Number(row.value);
    if (name in quotas && Number.isFinite(value) && value >= 0) quotas[name] = value;
  }
  return quotas;
}
