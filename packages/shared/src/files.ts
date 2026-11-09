/** Validação de tipo real de arquivo por magic bytes (briefing §5.4). */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
  'text/markdown',
] as const;
export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

const TEXT_MIMES: readonly string[] = ['text/plain', 'text/csv', 'text/markdown'];
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type DetectedKind = 'pdf' | 'jpeg' | 'png' | 'zip' | 'text' | 'unknown';

function startsWith(bytes: Uint8Array, sig: readonly number[]): boolean {
  if (bytes.length < sig.length) return false;
  return sig.every((b, i) => bytes[i] === b);
}

function isProbablyText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  for (const b of bytes) {
    if (b === 0) return false;
  }
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function detectKind(head: Uint8Array): DetectedKind {
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) return 'zip';
  if (isProbablyText(head)) return 'text';
  return 'unknown';
}

export type UploadCheck =
  | { ok: true; mime: AllowedMime }
  | { ok: false; code: 'FILE_TYPE_NOT_ALLOWED' | 'FILE_TOO_LARGE' | 'FILE_CONTENT_MISMATCH' };

export function isAllowedMime(mime: string): mime is AllowedMime {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Confere o tipo declarado contra o conteúdo real.
 * @param head primeiros bytes do objeto (recomendado: 4096)
 * @param tail últimos bytes do objeto (recomendado: 65536), usado para validar DOCX
 */
export function validateUpload(input: {
  declaredMime: string;
  size: number;
  maxBytes: number;
  head: Uint8Array;
  tail?: Uint8Array;
}): UploadCheck {
  const { declaredMime, size, maxBytes, head, tail } = input;
  if (!isAllowedMime(declaredMime)) return { ok: false, code: 'FILE_TYPE_NOT_ALLOWED' };
  if (size <= 0 || size > maxBytes) return { ok: false, code: 'FILE_TOO_LARGE' };

  const kind = detectKind(head);
  const mismatch = { ok: false, code: 'FILE_CONTENT_MISMATCH' } as const;

  if (declaredMime === 'application/pdf')
    return kind === 'pdf' ? { ok: true, mime: declaredMime } : mismatch;
  if (declaredMime === 'image/jpeg')
    return kind === 'jpeg' ? { ok: true, mime: declaredMime } : mismatch;
  if (declaredMime === 'image/png')
    return kind === 'png' ? { ok: true, mime: declaredMime } : mismatch;
  if (declaredMime === DOCX_MIME) {
    if (kind !== 'zip' || !tail) return mismatch;
    const tailText = new TextDecoder('latin1').decode(tail);
    return tailText.includes('word/document.xml') ? { ok: true, mime: declaredMime } : mismatch;
  }
  if (TEXT_MIMES.includes(declaredMime)) {
    return kind === 'text' ? { ok: true, mime: declaredMime } : mismatch;
  }
  return { ok: false, code: 'FILE_TYPE_NOT_ALLOWED' };
}
