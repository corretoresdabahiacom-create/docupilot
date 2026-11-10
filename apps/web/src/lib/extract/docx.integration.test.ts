// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// No navegador o bundler usa a build "browser" do mammoth (aceita ArrayBuffer); no Node o
// pacote padrão só aceita Buffer. O teste usa a mesma build do navegador.
vi.mock('mammoth', async () => {
  const mod = (await import('mammoth/mammoth.browser.js')) as { default?: unknown };
  return { default: mod.default ?? mod };
});

import { extractDocx } from './docx';

describe('extractDocx com mammoth real', () => {
  it('extrai o texto bruto em seções', async () => {
    const bytes = readFileSync(new URL('./fixtures/sample.docx', import.meta.url));
    const r = await extractDocx(new Blob([bytes]));
    expect(r.status).toBe('extracted');
    if (r.status === 'extracted') {
      expect(r.pageKind).toBe('section');
      expect(r.pages[0]!.text).toContain('Termo de confidencialidade');
      expect(r.pages[0]!.text).toContain('manter sigilo');
    }
  });
  it('arquivo corrompido vira extraction_failed', async () => {
    expect(await extractDocx(new Blob(['não é um zip']))).toEqual({
      status: 'extraction_failed',
      reason: 'read_error',
    });
  });
});
