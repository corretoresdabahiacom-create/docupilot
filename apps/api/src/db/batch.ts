import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../types';

/** Qualquer query builder do drizzle (insert/update/delete/select) que sabe se descrever em SQL. */
interface Describable {
  toSQL(): { sql: string; params: unknown[] };
}

/** Reconstrói um SQL parametrizado (`$1`, `$2`…) para executar dentro da transação. */
function toSqlObject(q: Describable): SQL {
  const { sql: text, params } = q.toSQL();
  const parts = text.split(/\$(\d+)/);
  const chunks: SQL[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) chunks.push(sql.raw(parts[i] as string));
    } else {
      chunks.push(sql`${params[Number(parts[i]) - 1]}`);
    }
  }
  return sql.join(chunks, sql``);
}

/**
 * Executa várias queries de forma atômica, na ordem dada (tudo ou nada). Os builders são criados
 * contra `db`; aqui só os descrevemos em SQL e os reexecutamos na MESMA transação, o que evita
 * reescrever cada chamada para receber um `tx`. Todos precisam ser builders do drizzle.
 */
export async function runBatch(db: Db, queries: unknown[]): Promise<void> {
  if (queries.length === 0) return;
  const statements = queries.map((q) => {
    if (!q || typeof (q as Describable).toSQL !== 'function') {
      throw new Error('runBatch: query sem toSQL()');
    }
    return toSqlObject(q as Describable);
  });
  await db.transaction(async (tx) => {
    for (const s of statements) await tx.execute(s);
  });
}
