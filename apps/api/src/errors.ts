import type { ErrorCode } from '@docupilot/shared';

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: Record<string, string | number | boolean>,
  ) {
    super(message);
  }
}

export const unauthenticated = () =>
  new AppError('UNAUTHENTICATED', 401, 'Sessão inválida ou expirada.');
export const forbidden = () => new AppError('FORBIDDEN', 403, 'Sem permissão para esta operação.');
export const notFound = () => new AppError('NOT_FOUND', 404, 'Recurso não encontrado.');
