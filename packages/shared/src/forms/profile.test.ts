import { describe, expect, it } from 'vitest';
import { normalizeProfileFields, profileConfirmSchema, profileInputSchema } from './profile';

const NOW = new Date('2026-11-12T12:00:00Z');

describe('normalizeProfileFields', () => {
  it('guarda a forma canônica e descarta vazios', () => {
    const r = normalizeProfileFields(
      { cpf: '111.444.777-35', birth_date: '05/03/1990', email: 'ANA@x.com', city: '  ' },
      NOW,
    );
    expect(r).toEqual({
      ok: true,
      fields: { cpf: '11144477735', birth_date: '1990-03-05', email: 'ana@x.com' },
    });
  });
  it('lista os campos inválidos (CPF com dígito errado, data impossível)', () => {
    expect(
      normalizeProfileFields({ cpf: '111.444.777-36', birth_date: '31/02/1990' }, NOW),
    ).toEqual({
      ok: false,
      invalid: ['cpf', 'birth_date'],
      empty: false,
    });
  });
  it('perfil sem nenhum campo é recusado', () => {
    expect(normalizeProfileFields({}, NOW)).toEqual({ ok: false, invalid: [], empty: true });
    expect(normalizeProfileFields({ city: '   ' }, NOW)).toEqual({
      ok: false,
      invalid: [],
      empty: true,
    });
  });
});

describe('schemas', () => {
  it('recusa campo desconhecido e rótulo vazio', () => {
    expect(profileInputSchema.safeParse({ label: 'x', fields: { senha: '1' } }).success).toBe(
      false,
    );
    expect(profileInputSchema.safeParse({ label: ' ', fields: { cpf: '1' } }).success).toBe(false);
    expect(profileInputSchema.safeParse({ label: 'Pessoal', fields: { cpf: '1' } }).success).toBe(
      true,
    );
  });
  it('confirmação precisa ser literalmente true', () => {
    expect(profileConfirmSchema.safeParse({ confirm: true }).success).toBe(true);
    expect(profileConfirmSchema.safeParse({ confirm: 'true' }).success).toBe(false);
    expect(profileConfirmSchema.safeParse({}).success).toBe(false);
  });
});
