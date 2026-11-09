import { describe, expect, it } from 'vitest';
import { validateUpload } from './files';

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...n: number[]) => new Uint8Array(n);
const base = { size: 1000, maxBytes: 25 * 1024 ** 2 };

describe('validateUpload', () => {
  it('aceita PDF real', () => {
    const r = validateUpload({
      ...base,
      declaredMime: 'application/pdf',
      head: enc('%PDF-1.7\n...'),
    });
    expect(r).toEqual({ ok: true, mime: 'application/pdf' });
  });
  it('rejeita PDF declarado cujo conteúdo é PNG', () => {
    const png = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0);
    const r = validateUpload({ ...base, declaredMime: 'application/pdf', head: png });
    expect(r).toEqual({ ok: false, code: 'FILE_CONTENT_MISMATCH' });
  });
  it('aceita JPEG e PNG reais', () => {
    expect(
      validateUpload({ ...base, declaredMime: 'image/jpeg', head: bytes(0xff, 0xd8, 0xff, 0xe0) })
        .ok,
    ).toBe(true);
    expect(
      validateUpload({
        ...base,
        declaredMime: 'image/png',
        head: bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
      }).ok,
    ).toBe(true);
  });
  it('DOCX exige ZIP com word/document.xml no final', () => {
    const zip = bytes(0x50, 0x4b, 0x03, 0x04, 0, 0);
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    expect(
      validateUpload({
        ...base,
        declaredMime: mime,
        head: zip,
        tail: enc('xx word/document.xml xx'),
      }).ok,
    ).toBe(true);
    expect(
      validateUpload({ ...base, declaredMime: mime, head: zip, tail: enc('outro.zip') }).ok,
    ).toBe(false);
    expect(validateUpload({ ...base, declaredMime: mime, head: zip }).ok).toBe(false);
  });
  it('texto aceita UTF-8 e rejeita binário', () => {
    expect(validateUpload({ ...base, declaredMime: 'text/csv', head: enc('a,b\n1,2\n') }).ok).toBe(
      true,
    );
    expect(
      validateUpload({ ...base, declaredMime: 'text/plain', head: bytes(0x41, 0x00, 0x42) }).ok,
    ).toBe(false);
  });
  it('rejeita MIME fora da lista', () => {
    const r = validateUpload({
      ...base,
      declaredMime: 'application/x-msdownload',
      head: enc('MZ'),
    });
    expect(r).toEqual({ ok: false, code: 'FILE_TYPE_NOT_ALLOWED' });
  });
  it('rejeita arquivo vazio ou acima do limite', () => {
    expect(
      validateUpload({ ...base, size: 0, declaredMime: 'application/pdf', head: enc('%PDF-') }),
    ).toEqual({
      ok: false,
      code: 'FILE_TOO_LARGE',
    });
    expect(
      validateUpload({
        ...base,
        size: base.maxBytes + 1,
        declaredMime: 'application/pdf',
        head: enc('%PDF-'),
      }),
    ).toEqual({ ok: false, code: 'FILE_TOO_LARGE' });
  });
});
