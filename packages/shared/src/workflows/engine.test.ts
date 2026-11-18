import { describe, expect, it } from 'vitest';
import { clipResult, RetryableError, runWorkflow, type StepExecutor } from './engine';
import type { StepKind } from './schema';

const steps = (...kinds: StepKind[]) => kinds.map((kind) => ({ kind, config: {} }));
const ok: StepExecutor = async (s) => ({ kind: 'done', result: { step: s.position } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('execução linear', () => {
  it('roda todos os passos em ordem e registra cada um', async () => {
    const r = await runWorkflow({
      steps: steps('input_extract', 'validate', 'output'),
      startIndex: 0,
      ctx: {},
      usedMs: 0,
      execute: ok,
    });
    expect(r.status).toBe('completed');
    expect(r.log.map((l) => [l.position, l.kind, l.status, l.attempts])).toEqual([
      [1, 'input_extract', 'completed', 1],
      [2, 'validate', 'completed', 1],
      [3, 'output', 'completed', 1],
    ]);
    for (const l of r.log) expect(l.finishedAt).toBeGreaterThanOrEqual(l.startedAt);
    expect(r.nextIndex).toBe(3);
  });

  it('o contexto devolvido por um passo chega ao seguinte', async () => {
    const seen: unknown[] = [];
    const r = await runWorkflow({
      steps: steps('input_extract', 'validate'),
      startIndex: 0,
      ctx: {},
      usedMs: 0,
      execute: async (s, ctx) => {
        seen.push({ ...ctx });
        return { kind: 'done', result: null, ctx: s.position === 1 ? { fields: [1, 2] } : {} };
      },
    });
    expect(seen[1]).toEqual({ fields: [1, 2] });
    expect(r.ctx).toEqual({ fields: [1, 2] });
  });

  it('falha de regra encerra a execução sem repetir e sem rodar os próximos', async () => {
    let calls = 0;
    const r = await runWorkflow({
      steps: steps('input_extract', 'validate', 'output'),
      startIndex: 0,
      ctx: {},
      usedMs: 0,
      execute: async (s) => {
        calls++;
        return s.position === 2
          ? { kind: 'fail', error: 'falta cpf' }
          : { kind: 'done', result: 1 };
      },
    });
    expect(r.status).toBe('failed');
    expect(calls).toBe(2);
    expect(r.log.at(-1)).toMatchObject({
      position: 2,
      status: 'failed',
      attempts: 1,
      error: 'falta cpf',
    });
    expect(r.nextIndex).toBe(1);
  });

  it('erro não transitório não é repetido', async () => {
    let calls = 0;
    const r = await runWorkflow({
      steps: steps('validate'),
      startIndex: 0,
      ctx: {},
      usedMs: 0,
      execute: async () => {
        calls++;
        throw new Error('bug');
      },
    });
    expect(calls).toBe(1);
    expect(r.status).toBe('failed');
    expect(r.log[0]?.error).toBe('bug');
  });
});

describe('retry (máximo 2 repetições)', () => {
  it('falha transitória que se resolve na 3ª tentativa passa', async () => {
    let calls = 0;
    const r = await runWorkflow({
      steps: steps('input_extract'),
      startIndex: 0,
      ctx: {},
      usedMs: 0,
      execute: async () => {
        if (++calls < 3) throw new RetryableError('banco ocupado');
        return { kind: 'done', result: 'ok' };
      },
    });
    expect(r.status).toBe('completed');
    expect(r.log[0]).toMatchObject({ status: 'completed', attempts: 3 });
  });

  it('falha transitória persistente para na 3ª tentativa (nunca mais de 3)', async () => {
    let calls = 0;
    const r = await runWorkflow({
      steps: steps('input_extract', 'output'),
      startIndex: 0,
      ctx: {},
      usedMs: 0,
      execute: async () => {
        calls++;
        throw new RetryableError('sempre falha');
      },
    });
    expect(calls).toBe(3);
    expect(r.status).toBe('failed');
    expect(r.log).toHaveLength(1);
    expect(r.log[0]).toMatchObject({ status: 'failed', attempts: 3, error: 'sempre falha' });
  });

  it('maxRetries configurável (0 = sem repetição)', async () => {
    let calls = 0;
    await runWorkflow({
      steps: steps('validate'),
      startIndex: 0,
      ctx: {},
      usedMs: 0,
      limits: { maxRetries: 0 },
      execute: async () => {
        calls++;
        throw new RetryableError('x');
      },
    });
    expect(calls).toBe(1);
  });
});

describe('timeout', () => {
  it('passo lento estoura o tempo do passo, é repetido 2 vezes e a execução vira timed_out', async () => {
    let calls = 0;
    const r = await runWorkflow({
      steps: steps('compare', 'output'),
      startIndex: 0,
      ctx: {},
      usedMs: 0,
      limits: { stepTimeoutMs: 20 },
      execute: async () => {
        calls++;
        await sleep(200);
        return { kind: 'done', result: 1 };
      },
    });
    expect(calls).toBe(3);
    expect(r.status).toBe('failed'); // falhou por tempo do passo, não do total
    expect(r.log[0]).toMatchObject({
      status: 'timed_out',
      attempts: 3,
      error: 'tempo do passo esgotado',
    });
    expect(r.log).toHaveLength(1);
  });

  it('passo que demora menos que o limite passa', async () => {
    const r = await runWorkflow({
      steps: steps('compare'),
      startIndex: 0,
      ctx: {},
      usedMs: 0,
      limits: { stepTimeoutMs: 100 },
      execute: async () => {
        await sleep(10);
        return { kind: 'done', result: 1 };
      },
    });
    expect(r.status).toBe('completed');
  });

  it('tempo total esgotado antes do passo: timed_out sem executar', async () => {
    let clock = 0;
    let calls = 0;
    const r = await runWorkflow({
      steps: steps('input_extract', 'validate', 'output'),
      startIndex: 0,
      ctx: {},
      usedMs: 0,
      now: () => clock,
      limits: { totalTimeoutMs: 1000 },
      execute: async () => {
        calls++;
        clock += 600; // cada passo "gasta" 600 ms
        return { kind: 'done', result: 1 };
      },
    });
    expect(calls).toBe(2);
    expect(r.status).toBe('timed_out');
    expect(r.log.map((l) => l.status)).toEqual(['completed', 'completed', 'timed_out']);
    expect(r.log[2]?.error).toBe('tempo total esgotado');
    expect(r.nextIndex).toBe(2);
  });

  it('o tempo ativo de execuções anteriores conta no total', async () => {
    const r = await runWorkflow({
      steps: steps('output'),
      startIndex: 0,
      ctx: {},
      usedMs: 299_999,
      now: (() => {
        let t = 0;
        return () => (t += 5);
      })(),
      execute: ok,
    });
    expect(r.status).toBe('timed_out');
  });

  it('estouro do total durante um passo lento vira timed_out', async () => {
    const r = await runWorkflow({
      steps: steps('compare'),
      startIndex: 0,
      ctx: {},
      usedMs: 0,
      limits: { totalTimeoutMs: 30, stepTimeoutMs: 1000 },
      execute: async () => {
        await sleep(300);
        return { kind: 'done', result: 1 };
      },
    });
    expect(r.status).toBe('timed_out');
  });
});

describe('aprovação (pausa e retomada)', () => {
  const exec: StepExecutor = async (s) =>
    s.kind === 'approval'
      ? { kind: 'pause', result: { waiting: true } }
      : { kind: 'done', result: s.position };

  it('pausa no passo de aprovação e não executa os seguintes', async () => {
    const r = await runWorkflow({
      steps: steps('input_extract', 'approval', 'output'),
      startIndex: 0,
      ctx: {},
      usedMs: 0,
      execute: exec,
    });
    expect(r.status).toBe('awaiting_approval');
    expect(r.nextIndex).toBe(1);
    expect(r.log.map((l) => l.status)).toEqual(['completed', 'awaiting_approval']);
  });

  it('retoma depois da aprovação com startIndex e acumula o tempo ativo', async () => {
    const r = await runWorkflow({
      steps: steps('input_extract', 'approval', 'output'),
      startIndex: 2,
      ctx: { a: 1 },
      usedMs: 1234,
      execute: exec,
    });
    expect(r.status).toBe('completed');
    expect(r.log.map((l) => l.kind)).toEqual(['output']);
    expect(r.usedMs).toBeGreaterThanOrEqual(1234);
  });
});

describe('clipResult', () => {
  it('resultado grande é cortado (nunca guarda conteúdo longo)', () => {
    expect(clipResult({ a: 1 })).toEqual({ a: 1 });
    const big = clipResult({ text: 'x'.repeat(5000) }) as { truncated: boolean; preview: string };
    expect(big.truncated).toBe(true);
    expect(big.preview.length).toBe(300);
    expect(clipResult(undefined)).toBeUndefined();
  });
});
