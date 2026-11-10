import { describe, expect, it } from 'vitest';
import { detectLanguage, PATTERN_ID } from './language_detect';

describe(PATTERN_ID, () => {
  it.each([
    [
      'pt',
      'O presente contrato é celebrado entre as partes para a prestação de serviços, conforme as condições abaixo e o que foi acordado. Os valores são pagos no prazo, não havendo mais nada a tratar sobre este assunto.',
    ],
    [
      'en',
      'This agreement is made between the parties and shall be governed by the terms of the contract. The party of the first part will pay the fees on the date that is set out in this agreement, and not later.',
    ],
    [
      'es',
      'El presente contrato se celebra entre las partes para la prestación de servicios, según las condiciones que se indican. Los pagos se harán en el plazo y no habrá más cambios sobre este asunto.',
    ],
  ])('detecta %s', (lang, text) => {
    const r = detectLanguage(text);
    expect(r.language).toBe(lang);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it.each(['', '123 456 789', 'xyz qwk', 'R$ 10,00 2024-01-01', '--- ---'])(
    'devolve und para "%s"',
    (t) => {
      expect(detectLanguage(t)).toEqual({ language: 'und', confidence: 0 });
    },
  );

  it('só olha os primeiros 5.000 caracteres', () => {
    const en = 'the agreement shall be made by the parties and the party will pay for it. '.repeat(
      10,
    );
    const pt = ' o contrato não foi feito pelas partes para os seus fins. '.repeat(200);
    expect(detectLanguage(en + 'x'.repeat(5000) + pt).language).toBe('en');
  });
});
