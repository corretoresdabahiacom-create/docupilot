export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message?: string,
  ) {
    super(message ?? code);
  }
}

const BASE = import.meta.env.VITE_API_URL ?? '';

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: opts.method ?? 'GET',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'docupilot' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch {
    throw new ApiError('NETWORK', 0);
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(data?.error?.code ?? 'INTERNAL', res.status, data?.error?.message);
  }
  return data as T;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  isPersonal: boolean;
  role: string;
}
export interface Me {
  user: { id: string; email: string; displayName: string };
  workspaces: WorkspaceSummary[];
}
export interface DocumentRow {
  id: string;
  name: string;
  mime: string;
  status: 'needs_text' | 'extracted' | 'needs_ocr' | 'extraction_failed';
  createdAt: number;
}
export interface Health {
  status: string;
  storage: { configured: boolean; provider: string | null };
  turnstile: { configured: boolean };
  flags: Record<string, boolean>;
}
