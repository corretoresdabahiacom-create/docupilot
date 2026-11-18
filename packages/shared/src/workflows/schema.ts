/**
 * Workflows lineares (Fase 6, D15): lista ordenada de passos, sem ramificação nem laços, no
 * máximo 10 passos e nenhum passo que aja fora do DocuPilot (sem e-mail, webhook, assinatura
 * ou protocolo). A ordem é validada na criação.
 */
import { z } from 'zod';
import { findPlaceholders, getTemplate, TEMPLATE_KEYS } from '../documents/templates';

export const STEP_KINDS = [
  'input_extract',
  'validate',
  'compare',
  'generate',
  'approval',
  'output',
] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const MAX_STEPS = 10;
export const MAX_APPROVALS_PER_WORKFLOW = 3;
export const TOTAL_TIMEOUT_MS = 5 * 60_000;
export const STEP_TIMEOUT_MS = 30_000;
export const MAX_RETRIES = 2;
export const MAX_WORKFLOWS_PER_WORKSPACE = 50;

const fieldType = z.string().regex(/^[a-z][a-z0-9_]{1,29}$/);
const placeholder = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/);

const configs = {
  input_extract: z.strictObject({ input: z.enum(['primary', 'secondary']) }),
  validate: z.strictObject({
    requiredTypes: z.array(fieldType).max(10).default([]),
    failOnInconsistency: z.boolean().default(false),
  }),
  compare: z.strictObject({}),
  generate: z.strictObject({
    templateKey: z.enum(TEMPLATE_KEYS),
    title: z.string().trim().min(1).max(200),
    /** placeholder do modelo → tipo (e rótulo opcional) do campo extraído que o preenche. */
    mapping: z
      .record(
        placeholder,
        z.strictObject({ fieldType, label: z.string().trim().max(60).optional() }),
      )
      .default({}),
  }),
  approval: z.strictObject({ note: z.string().trim().max(300).optional() }),
  output: z.strictObject({}),
} as const;

export const stepSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('input_extract'), config: configs.input_extract }),
  z.strictObject({ kind: z.literal('validate'), config: configs.validate }),
  z.strictObject({ kind: z.literal('compare'), config: configs.compare.default({}) }),
  z.strictObject({ kind: z.literal('generate'), config: configs.generate }),
  z.strictObject({ kind: z.literal('approval'), config: configs.approval.default({}) }),
  z.strictObject({ kind: z.literal('output'), config: configs.output.default({}) }),
]);
export type WorkflowStep = z.infer<typeof stepSchema>;

export const workflowInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  steps: z.array(stepSchema).min(1).max(MAX_STEPS),
});
export type WorkflowInput = z.infer<typeof workflowInputSchema>;

/** Regras de ordem que o schema sozinho não expressa. Devolve a primeira violação ou null. */
export function validateStepOrder(
  steps: readonly { kind: StepKind; config: unknown }[],
): string | null {
  const seen = new Set<string>();
  let approvals = 0;
  let generated = false;
  for (const [i, s] of steps.entries()) {
    const at = `passo ${i + 1}`;
    if (s.kind === 'input_extract') {
      const input = (s.config as { input: string }).input;
      if (seen.has(`in:${input}`)) return `${at}: a entrada "${input}" já foi lida antes`;
      seen.add(`in:${input}`);
    }
    if (s.kind === 'validate' || s.kind === 'generate') {
      if (!seen.has('in:primary'))
        return `${at}: precisa de um passo input_extract (primary) antes`;
    }
    if (s.kind === 'compare' && !(seen.has('in:primary') && seen.has('in:secondary'))) {
      return `${at}: comparar exige input_extract de primary e secondary antes`;
    }
    if (s.kind === 'generate') {
      if (generated) return `${at}: só é permitido um passo generate`;
      generated = true;
      const cfg = s.config as { templateKey: string; mapping: Record<string, unknown> };
      const tpl = getTemplate(cfg.templateKey);
      if (tpl) {
        const known = new Set(findPlaceholders(tpl.doc));
        const bad = Object.keys(cfg.mapping).filter((k) => !known.has(k));
        if (bad.length) return `${at}: o modelo não tem o(s) campo(s) ${bad.join(', ')}`;
      }
    }
    if (s.kind === 'approval' && ++approvals > MAX_APPROVALS_PER_WORKFLOW) {
      return `${at}: no máximo ${MAX_APPROVALS_PER_WORKFLOW} aprovações`;
    }
    if (s.kind === 'output' && i !== steps.length - 1)
      return `${at}: output deve ser o último passo`;
  }
  if (steps.filter((s) => s.kind === 'output').length > 1) return 'só é permitido um passo output';
  return null;
}

/** Quais entradas o workflow exige ao iniciar. */
export function requiredInputs(
  steps: readonly { kind: StepKind; config: unknown }[],
): Array<'primary' | 'secondary'> {
  const out = new Set<'primary' | 'secondary'>();
  for (const s of steps) {
    if (s.kind === 'input_extract') out.add((s.config as { input: 'primary' | 'secondary' }).input);
  }
  return [...out];
}
