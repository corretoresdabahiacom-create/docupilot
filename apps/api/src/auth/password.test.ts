import { describe, expect, it } from 'vitest';
import { hashPassword, MAX_ITERATIONS, verifyPassword } from './password';

describe('password', () => {
  it('valida a senha correta e rejeita a errada', async () => {
    const h = await hashPassword('minha-senha-longa-123', 1000);
    expect(h.startsWith('pbkdf2-sha256$1000$')).toBe(true);
    expect(await verifyPassword('minha-senha-longa-123', h)).toBe(true);
    expect(await verifyPassword('outra-senha-qualquer', h)).toBe(false);
  });
  it('gera salt diferente a cada hash', async () => {
    expect(await hashPassword('x'.repeat(12), 1000)).not.toBe(
      await hashPassword('x'.repeat(12), 1000),
    );
  });
  it('limita iterações ao máximo do Workers', async () => {
    const h = await hashPassword('x'.repeat(12), MAX_ITERATIONS + 5000);
    expect(h.split('$')[1]).toBe(String(MAX_ITERATIONS));
  });
  it('rejeita formatos malformados e iterações absurdas', async () => {
    expect(await verifyPassword('x', 'lixo')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2-sha256$999999999$AAAA$AAAA')).toBe(false);
  });
});
