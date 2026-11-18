import { describe, expect, it } from 'vitest';
import {
  MAX_STEPS,
  requiredInputs,
  stepSchema,
  validateStepOrder,
  workflowInputSchema,
  type StepKind,
} from './schema';

const s = (kind: StepKind, config: unknown = {}) => ({ kind, config });
const inP = s('input_extract', { input: 'primary' });
const inS = s('input_extract', { input: 'secondary' });
const gen = s('generate', {
  templateKey: 'recibo',
  title: 'Recibo',
  mapping: { pagador: { fieldType: 'cpf' } },
});

describe('workflowInputSchema', () => {
  it('aceita um fluxo válido e preenche padrões', () => {
    const r = workflowInputSchema.parse({
      name: 'Fluxo',
      steps: [inP, { kind: 'validate', config: {} }, { kind: 'approval' }, { kind: 'output' }],
    });
    expect(r.steps[1]).toEqual({
      kind: 'validate',
      config: { requiredTypes: [], failOnInconsistency: false },
    });
    expect(r.steps[2]?.config).toEqual({});
  });
  it.each([
    ['nome vazio', { name: ' ', steps: [inP] }],
    ['sem passos', { name: 'x', steps: [] }],
    ['11 passos', { name: 'x', steps: Array.from({ length: MAX_STEPS + 1 }, () => inP) }],
    [
      'tipo de passo desconhecido (e-mail)',
      { name: 'x', steps: [{ kind: 'send_email', config: {} }] },
    ],
    ['webhook', { name: 'x', steps: [{ kind: 'webhook', config: { url: 'https://x' } }] }],
    [
      'config com campo extra',
      { name: 'x', steps: [{ kind: 'input_extract', config: { input: 'primary', url: 'x' } }] },
    ],
    [
      'modelo inexistente',
      { name: 'x', steps: [{ kind: 'generate', config: { templateKey: 'x', title: 'a' } }] },
    ],
    ['campo extra no passo', { name: 'x', steps: [{ kind: 'output', config: {}, next: 3 }] }],
  ])('recusa %s', (_n, input) => {
    expect(workflowInputSchema.safeParse(input).success).toBe(false);
  });
  it('exatamente 10 passos é aceito', () => {
    const steps = [
      inP,
      inS,
      s('compare'),
      s('validate'),
      s('approval'),
      s('approval'),
      s('approval'),
      gen,
      s('validate'),
      s('output'),
    ];
    expect(workflowInputSchema.safeParse({ name: 'x', steps }).success).toBe(true);
  });
  it('stepSchema aceita config ausente onde não há parâmetros', () => {
    expect(stepSchema.safeParse({ kind: 'compare' }).success).toBe(true);
  });
});

describe('validateStepOrder', () => {
  it('fluxo válido', () => {
    expect(
      validateStepOrder([inP, inS, s('compare'), s('validate'), gen, s('approval'), s('output')]),
    ).toBeNull();
  });
  it.each([
    ['validar sem ler a entrada', [s('validate')], /input_extract/],
    ['gerar sem ler a entrada', [gen], /input_extract/],
    ['comparar com uma entrada só', [inP, s('compare')], /primary e secondary/],
    ['mesma entrada duas vezes', [inP, inP], /já foi lida/],
    ['dois generate', [inP, gen, gen], /só é permitido um/],
    [
      '4 aprovações',
      [inP, s('approval'), s('approval'), s('approval'), s('approval')],
      /no máximo 3/,
    ],
    ['output no meio', [inP, s('output'), s('validate')], /último/],
  ] as const)('recusa: %s', (_n, steps, re) => {
    expect(validateStepOrder(steps as never)).toMatch(re);
  });
});

describe('requiredInputs', () => {
  it('lista as entradas pedidas', () => {
    expect(requiredInputs([inP, inS, s('compare')]).sort()).toEqual(['primary', 'secondary']);
    expect(requiredInputs([inP])).toEqual(['primary']);
    expect(requiredInputs([s('approval')])).toEqual([]);
  });
});

describe('validateStepOrder — mapeamento do modelo', () => {
  it('recusa campo que o modelo não tem e aceita campo existente', () => {
    const read = { kind: 'input_extract', config: { input: 'primary' } } as const;
    const gen = (mapping: Record<string, unknown>) =>
      ({ kind: 'generate', config: { templateKey: 'declaracao', title: 'x', mapping } }) as const;
    expect(validateStepOrder([read, gen({ inexistente: { fieldType: 'cnpj' } })])).toMatch(
      /inexistente/,
    );
    expect(validateStepOrder([read, gen({ declarante: { fieldType: 'cnpj' } })])).toBeNull();
  });
});
