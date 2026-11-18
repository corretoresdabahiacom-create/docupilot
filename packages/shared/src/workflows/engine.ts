/**
 * Motor de execução linear (D15). Puro: quem chama injeta o relógio e o executor de cada passo.
 * - Timeout por passo (30 s) e total de 5 min de tempo ATIVO (a espera por aprovação não conta).
 * - Retry: no máximo 2 repetições (3 tentativas) só para falha transitória (RetryableError) e para
 *   estouro do tempo do passo. Falha de regra (ex.: campo ausente) NÃO é repetida.
 * - Aprovação pausa a execução; o chamador retoma depois com `startIndex`.
 * - Cada passo gera uma entrada de log com horários, tentativas e resultado resumido.
 */
import { MAX_RETRIES, STEP_TIMEOUT_MS, TOTAL_TIMEOUT_MS, type StepKind } from './schema';

export class RetryableError extends Error {
  readonly retryable = true;
}

export type StepOutcome =
  | { kind: 'done'; result: unknown; ctx?: Record<string, unknown> }
  | { kind: 'pause'; result?: unknown }
  | { kind: 'fail'; error: string };

export type ExecutionStatus =
  'completed' | 'failed' | 'timed_out' | 'awaiting_approval' | 'rejected' | 'cancelled';

export interface StepLogEntry {
  position: number;
  kind: StepKind;
  status: 'completed' | 'failed' | 'timed_out' | 'awaiting_approval' | 'rejected';
  attempts: number;
  startedAt: number;
  finishedAt: number;
  result?: unknown;
  error?: string;
}

export interface EngineLimits {
  stepTimeoutMs: number;
  totalTimeoutMs: number;
  maxRetries: number;
}
export const DEFAULT_LIMITS: EngineLimits = {
  stepTimeoutMs: STEP_TIMEOUT_MS,
  totalTimeoutMs: TOTAL_TIMEOUT_MS,
  maxRetries: MAX_RETRIES,
};

export type StepExecutor = (
  step: { position: number; kind: StepKind; config: unknown },
  ctx: Record<string, unknown>,
  info: { attempt: number },
) => Promise<StepOutcome>;

export interface RunInput {
  steps: readonly { kind: StepKind; config: unknown }[];
  startIndex: number;
  ctx: Record<string, unknown>;
  /** Tempo ativo já gasto em execuções anteriores (antes de uma pausa). */
  usedMs: number;
  execute: StepExecutor;
  now?: () => number;
  limits?: Partial<EngineLimits>;
}

export interface RunOutput {
  status: ExecutionStatus;
  log: StepLogEntry[];
  /** Índice do próximo passo a executar (em pausa: o do passo de aprovação). */
  nextIndex: number;
  ctx: Record<string, unknown>;
  usedMs: number;
}

const MAX_RESULT_CHARS = 2000;
/** Resultado guardado no log precisa caber em poucos KB: nada de conteúdo de documento. */
export function clipResult(value: unknown): unknown {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  if (text.length <= MAX_RESULT_CHARS) return value;
  return { truncated: true, preview: text.slice(0, 300) };
}

class StepTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new StepTimeout()), Math.max(1, ms));
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

export async function runWorkflow(input: RunInput): Promise<RunOutput> {
  const now = input.now ?? Date.now;
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const runStart = now();
  const log: StepLogEntry[] = [];
  let ctx = input.ctx;
  const spent = () => input.usedMs + (now() - runStart);
  const out = (status: ExecutionStatus, nextIndex: number): RunOutput => ({
    status,
    log,
    nextIndex,
    ctx,
    usedMs: spent(),
  });

  for (let i = input.startIndex; i < input.steps.length; i++) {
    const step = input.steps[i];
    if (!step) break;
    const position = i + 1;
    const startedAt = now();
    let attempts = 0;

    for (;;) {
      const remaining = limits.totalTimeoutMs - spent();
      if (remaining <= 0) {
        log.push({
          position,
          kind: step.kind,
          status: 'timed_out',
          attempts,
          startedAt,
          finishedAt: now(),
          error: 'tempo total esgotado',
        });
        return out('timed_out', i);
      }
      attempts++;
      try {
        const budget = Math.min(limits.stepTimeoutMs, remaining);
        const res = await withTimeout(
          input.execute({ position, kind: step.kind, config: step.config }, ctx, {
            attempt: attempts,
          }),
          budget,
        );
        if (res.kind === 'pause') {
          log.push({
            position,
            kind: step.kind,
            status: 'awaiting_approval',
            attempts,
            startedAt,
            finishedAt: now(),
            result: clipResult(res.result),
          });
          return out('awaiting_approval', i);
        }
        if (res.kind === 'fail') {
          log.push({
            position,
            kind: step.kind,
            status: 'failed',
            attempts,
            startedAt,
            finishedAt: now(),
            error: res.error,
          });
          return out('failed', i);
        }
        if (res.ctx) ctx = { ...ctx, ...res.ctx };
        log.push({
          position,
          kind: step.kind,
          status: 'completed',
          attempts,
          startedAt,
          finishedAt: now(),
          result: clipResult(res.result),
        });
        break;
      } catch (err) {
        const timedOut = err instanceof StepTimeout;
        const retryable = timedOut || err instanceof RetryableError;
        const lastError = timedOut
          ? 'tempo do passo esgotado'
          : err instanceof Error
            ? err.message
            : String(err);
        // Falha transitória: repete até `maxRetries` vezes. O resto falha na hora.
        if (retryable && attempts <= limits.maxRetries && limits.totalTimeoutMs - spent() > 0)
          continue;
        const totalGone = limits.totalTimeoutMs - spent() <= 0;
        log.push({
          position,
          kind: step.kind,
          status: totalGone ? 'timed_out' : timedOut ? 'timed_out' : 'failed',
          attempts,
          startedAt,
          finishedAt: now(),
          error: lastError,
        });
        return out(totalGone ? 'timed_out' : 'failed', i);
      }
    }
  }
  return out('completed', input.steps.length);
}
