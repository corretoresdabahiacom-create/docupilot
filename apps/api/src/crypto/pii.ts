/**
 * Criptografia de dados pessoais em repouso (AES-GCM 256, WebCrypto).
 * - A chave vem do segredo `PII_ENCRYPTION_KEY` (base64, 32 bytes). Sem ela, nada é gravado.
 * - Cada gravação usa um IV novo (12 bytes aleatórios).
 * - O AAD amarra o texto cifrado ao perfil e ao dono: trocar linhas no banco faz a leitura falhar.
 */
import { AppError } from '../errors';

const KEY_BYTES = 32;
const IV_BYTES = 12;

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array | null {
  try {
    const bin = atob(text.trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Chave configurada e com o tamanho certo? (usado também pelo /health) */
export function isPiiKeyValid(secret: string | undefined): boolean {
  if (!secret) return false;
  return fromBase64(secret)?.length === KEY_BYTES;
}

async function importKey(secret: string | undefined): Promise<CryptoKey> {
  const raw = secret ? fromBase64(secret) : null;
  if (!raw || raw.length !== KEY_BYTES) {
    throw new AppError(
      'SERVICE_NOT_CONFIGURED',
      503,
      'Perfis de dados pessoais indisponíveis: chave de criptografia não configurada.',
    );
  }
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

const aad = (profileId: string, userId: string) =>
  new TextEncoder().encode(`docupilot:profile:${profileId}:${userId}`);

export async function encryptProfile(
  secret: string | undefined,
  profileId: string,
  userId: string,
  data: unknown,
): Promise<{ encryptedPayload: string; iv: string }> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plain = new TextEncoder().encode(JSON.stringify(data));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aad(profileId, userId) },
    key,
    plain,
  );
  return { encryptedPayload: toBase64(new Uint8Array(cipher)), iv: toBase64(iv) };
}

/** Falha (AppError INTERNAL) se o texto foi adulterado, trocado de linha ou a chave mudou. */
export async function decryptProfile<T>(
  secret: string | undefined,
  profileId: string,
  userId: string,
  row: { encryptedPayload: string; iv: string },
): Promise<T> {
  const key = await importKey(secret);
  const iv = fromBase64(row.iv);
  const cipher = fromBase64(row.encryptedPayload);
  if (!iv || !cipher) throw new AppError('INTERNAL', 500, 'Perfil ilegível.');
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad(profileId, userId) },
      key,
      cipher as BufferSource,
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    throw new AppError('INTERNAL', 500, 'Perfil ilegível (adulterado ou chave diferente).');
  }
}
