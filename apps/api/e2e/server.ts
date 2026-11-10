/**
 * Servidor de desenvolvimento para o teste de fumaça no navegador (apps/web/e2e/smoke.mjs).
 * NÃO é o Worker de produção: roda a mesma API (Hono) em Node, com SQLite em memória
 * (libSQL) e armazenamento em memória exposto em /__storage, no mesmo domínio do front
 * já compilado (apps/web/dist). Serve só para exercitar o fluxo completo localmente.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import * as schema from '../src/db/schema';
import { createApp } from '../src/app';
import { MemoryStorage } from '../src/storage/memory';
import type { Db } from '../src/types';

const PORT = Number(process.env.PORT ?? 8799);
const ORIGIN = `http://localhost:${PORT}`;
const ROOT = new URL('../../..', import.meta.url).pathname;
const DIST = join(ROOT, 'apps/web/dist');

class HttpMemoryStorage extends MemoryStorage {
  override async createUploadUrl(input: { key: string; contentType: string }) {
    return {
      url: `${ORIGIN}/__storage/${input.key}`,
      method: 'PUT' as const,
      headers: { 'content-type': input.contentType },
    };
  }
  override async createDownloadUrl(key: string) {
    return `${ORIGIN}/__storage/${key}`;
  }
}

const client = createClient({ url: 'file::memory:' });
const db = drizzle(client, { schema }) as unknown as Db;
await migrate(db as unknown as Parameters<typeof migrate>[0], {
  migrationsFolder: join(ROOT, 'apps/api/migrations'),
});
const storage = new HttpMemoryStorage();
const app = createApp({
  db,
  storage,
  config: { environment: 'development', allowedOrigins: [ORIGIN], pbkdf2Iterations: 1000 },
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

async function readBody(req: import('node:http').IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', ORIGIN);
    if (url.pathname.startsWith('/__storage/')) {
      const key = decodeURIComponent(url.pathname.slice('/__storage/'.length));
      if (req.method === 'PUT') {
        storage.put(key, new Uint8Array(await readBody(req)));
        res.writeHead(200).end();
      } else {
        const obj = storage.objects.get(key);
        if (!obj) return void res.writeHead(404).end();
        res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(Buffer.from(obj));
      }
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
      }
      const response = await app.fetch(
        new Request(url, {
          method: req.method,
          headers,
          body: body ? new Uint8Array(body) : undefined,
        }),
      );
      const out: Record<string, string | string[]> = {};
      response.headers.forEach((v, k) => (out[k] = v));
      const cookies = response.headers.getSetCookie();
      if (cookies.length) out['set-cookie'] = cookies;
      res.writeHead(response.status, out).end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    // Front estático com fallback de SPA.
    const safe = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIST, safe);
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch {
      file = join(DIST, 'index.html');
      data = await readFile(file);
    }
    res
      .writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      .end(data);
  } catch (err) {
    console.error('e2e server error', err);
    res.writeHead(500).end('error');
  }
}).listen(PORT, () => console.log(`e2e server on ${ORIGIN}`));
