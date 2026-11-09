import { AppError } from '../errors';
import type { AppConfig } from '../types';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verifica o token do Turnstile.
 * - Sem segredo em desenvolvimento/teste: ignora.
 * - Sem segredo em produção: recusa com SERVICE_NOT_CONFIGURED (R4: nunca fingir que protege).
 */
export async function verifyTurnstile(
  config: AppConfig,
  token: string | undefined,
  ip: string | null,
): Promise<void> {
  if (!config.turnstileSecret) {
    if (config.environment === 'production') {
      throw new AppError('SERVICE_NOT_CONFIGURED', 503, 'Verificação anti-robô não configurada.');
    }
    return;
  }
  if (!token) throw new AppError('VALIDATION_ERROR', 400, 'Verificação anti-robô ausente.');
  const body = new URLSearchParams({ secret: config.turnstileSecret, response: token });
  if (ip) body.set('remoteip', ip);
  const res = await (config.fetchImpl ?? fetch)(VERIFY_URL, { method: 'POST', body });
  const data = (await res.json()) as { success?: boolean };
  if (!data.success) throw new AppError('VALIDATION_ERROR', 400, 'Verificação anti-robô falhou.');
}
