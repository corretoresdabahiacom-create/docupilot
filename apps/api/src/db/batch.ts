import type { Db } from '../types';

/**
 * Executa várias queries de forma atômica. D1 e libSQL expõem `db.batch`, mas o tipo base do
 * drizzle não o declara; o cast fica isolado aqui.
 */
export async function runBatch(db: Db, queries: unknown[]): Promise<void> {
  if (queries.length === 0) return;
  await (db as unknown as { batch: (q: unknown[]) => Promise<unknown> }).batch(queries);
}
