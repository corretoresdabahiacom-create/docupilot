import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { eq } from 'drizzle-orm';
import { createApp } from '../app';
import * as schema from '../db/schema';
import { MemoryStorage } from '../storage/memory';
import type { AppConfig, Db } from '../types';

export interface TestEnv {
  app: ReturnType<typeof createApp>;
  db: Db;
  storage: MemoryStorage | null;
  config: AppConfig;
}

export async function createTestEnv(
  opts: { storage?: boolean; config?: Partial<AppConfig> } = {},
): Promise<TestEnv> {
  const client = createClient({ url: 'file::memory:' });
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as unknown as Parameters<typeof migrate>[0], {
    migrationsFolder: new URL('../../migrations', import.meta.url).pathname,
  });
  const storage = opts.storage === false ? null : new MemoryStorage();
  const config: AppConfig = {
    environment: 'test',
    allowedOrigins: ['https://app.test'],
    pbkdf2Iterations: 1000,
    ...opts.config,
  };
  return { app: createApp({ db, storage, config }), db, storage, config };
}

/** Cliente de teste com jar de cookies. */
export class Client {
  cookie = '';
  constructor(private readonly env: TestEnv) {}

  async request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const h: Record<string, string> = { 'content-type': 'application/json', ...headers };
    if (method !== 'GET' && !('origin' in h) && !('x-requested-with' in h))
      h['x-requested-with'] = 'docupilot';
    if (this.cookie) h.cookie = this.cookie;
    const res = await this.env.app.request(`http://localhost${path}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) {
      const pair = set.split(';')[0] ?? '';
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const text = await res.text();
    return {
      status: res.status,
      headers: res.headers,
      json: text ? (JSON.parse(text) as any) : null,
    };
  }
  get = (path: string) => this.request('GET', path);
  post = (path: string, body?: unknown, headers?: Record<string, string>) =>
    this.request('POST', path, body, headers);
}

export const PASSWORD = 'correct horse battery staple';

export async function registerUser(env: TestEnv, email: string, name = 'Teste') {
  const client = new Client(env);
  const res = await client.post('/api/auth/register', {
    email,
    password: PASSWORD,
    displayName: name,
  });
  if (res.status !== 201)
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.json)}`);
  return {
    client,
    userId: res.json.user.id as string,
    workspaceId: res.json.workspaceId as string,
  };
}

export async function addMember(env: TestEnv, workspaceId: string, userId: string, role: string) {
  await env.db.insert(schema.workspaceMembers).values({ workspaceId, userId, role });
}

export async function setSetting(env: TestEnv, key: string, value: string) {
  await env.db.insert(schema.systemSettings).values({ key, value });
}

export const sha = 'a'.repeat(64);
export const pdfBytes = (n = 200) => {
  const b = new Uint8Array(n);
  b.set(new TextEncoder().encode('%PDF-1.7\n'));
  return b;
};
export { eq, schema };
