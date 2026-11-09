import { fromBase64, timingSafeEqual, toBase64 } from './crypto';

const enc = new TextEncoder();
const HASH_BITS = 256;
/** O Workers limita PBKDF2 a 100.000 iterações. */
export const MAX_ITERATIONS = 100_000;

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    HASH_BITS,
  );
  return new Uint8Array(bits);
}

/** Formato: pbkdf2-sha256$<iterações>$<salt b64>$<hash b64> */
export async function hashPassword(password: string, iterations: number): Promise<string> {
  const iter = Math.min(iterations, MAX_ITERATIONS);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iter);
  return `pbkdf2-sha256$${iter}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterRaw, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'pbkdf2-sha256' || !iterRaw || !saltB64 || !hashB64) return false;
  const iterations = Number(iterRaw);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_ITERATIONS) return false;
  const actual = await derive(password, fromBase64(saltB64), iterations);
  return timingSafeEqual(actual, fromBase64(hashB64));
}
