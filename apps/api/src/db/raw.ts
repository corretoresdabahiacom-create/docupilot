import type { SQL } from 'drizzle-orm';
import type { Db } from '../types';

/** `db.execute` devolve um array (postgres-js) ou `{ rows }` (PGlite); aqui os dois viram array. */
export async function queryRows<T>(db: Db, query: SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown;
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}
