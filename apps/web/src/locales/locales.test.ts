import { describe, expect, it } from 'vitest';
import en from './en.json';
import pt from './pt.json';

function keys(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null
      ? keys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe('traduções', () => {
  it('PT e EN têm exatamente as mesmas chaves', () => {
    expect(keys(en).sort()).toEqual(keys(pt).sort());
  });
  it('todo código de erro da API tem mensagem traduzida', async () => {
    const { ERROR_CODES } = await import('@docupilot/shared');
    for (const code of ERROR_CODES) {
      expect((pt.errors as Record<string, string>)[code], `pt ${code}`).toBeTruthy();
      expect((en.errors as Record<string, string>)[code], `en ${code}`).toBeTruthy();
    }
  });
});
