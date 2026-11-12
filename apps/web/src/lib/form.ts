/**
 * Adaptador de pdf-lib (Fase 5, D14): lê os campos AcroForm e grava os valores CONFIRMADOS.
 * Roda no navegador; o PDF não passa pelo servidor. A decisão de "o que preencher" é do motor
 * em `@docupilot/shared` (forms/fill.ts); aqui só se faz a leitura e a escrita.
 */
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFOptionList,
  PDFRadioGroup,
  PDFSignature,
  PDFTextField,
  PDFButton,
  StandardFonts,
  PDFDict,
  type PDFField,
} from 'pdf-lib';
import type { PdfFieldType, RawFormField } from '@docupilot/shared';

export type FormReadResult =
  | { ok: true; fields: RawFormField[]; hasXfa: boolean }
  | { ok: false; reason: 'encrypted' | 'invalid' };

function pdfType(field: PDFField): PdfFieldType {
  if (field instanceof PDFTextField) return 'text';
  if (field instanceof PDFCheckBox) return 'checkbox';
  if (field instanceof PDFDropdown) return 'dropdown';
  if (field instanceof PDFRadioGroup) return 'radio';
  if (field instanceof PDFOptionList) return 'list';
  if (field instanceof PDFSignature) return 'signature';
  if (field instanceof PDFButton) return 'button';
  return 'unknown';
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

async function load(bytes: ArrayBuffer | Uint8Array): Promise<PDFDocument | 'encrypted' | null> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  } catch (err) {
    return err instanceof Error && /encrypt/i.test(`${err.name} ${err.message}`)
      ? 'encrypted'
      : null;
  }
}

function detectXfa(doc: PDFDocument): boolean {
  const acro = doc.catalog.lookup(PDFName.of('AcroForm'));
  return acro instanceof PDFDict && acro.has(PDFName.of('XFA'));
}

export async function readFormFields(bytes: ArrayBuffer | Uint8Array): Promise<FormReadResult> {
  const doc = await load(bytes);
  if (doc === 'encrypted') return { ok: false, reason: 'encrypted' };
  if (!doc) return { ok: false, reason: 'invalid' };
  const form = doc.getForm();
  const fields: RawFormField[] = form.getFields().map((f) => {
    const type = pdfType(f);
    let value: RawFormField['value'] = null;
    if (f instanceof PDFTextField) value = safe(() => f.getText()) ?? null;
    else if (f instanceof PDFCheckBox) value = safe(() => f.isChecked()) ?? false;
    else if (f instanceof PDFDropdown || f instanceof PDFOptionList)
      value = safe(() => f.getSelected()) ?? [];
    else if (f instanceof PDFRadioGroup) value = safe(() => f.getSelected()) ?? null;
    return {
      name: f.getName(),
      pdfType: type,
      value,
      readOnly: safe(() => f.isReadOnly()) ?? false,
      required: safe(() => f.isRequired()) ?? false,
      options:
        f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup
          ? (safe(() => f.getOptions()) ?? [])
          : undefined,
      maxLength: f instanceof PDFTextField ? safe(() => f.getMaxLength()) : undefined,
      multiline: f instanceof PDFTextField ? safe(() => f.isMultiline()) : undefined,
    };
  });
  return { ok: true, fields, hasXfa: detectXfa(doc) };
}

export interface FillOutcome {
  bytes: Uint8Array;
  written: string[];
  /** Campos que o pdf-lib recusou (ex.: caractere que a fonte não codifica); ficam como estavam. */
  failed: Array<{ name: string; error: string }>;
}

/**
 * Grava só os valores recebidos (a UI passa apenas os confirmados). Não achata o formulário:
 * os campos continuam editáveis. Campo que falhar é desfeito e relatado, nunca "meio escrito".
 */
export async function fillPdf(
  bytes: ArrayBuffer | Uint8Array,
  writes: Array<{ name: string; value: string | boolean }>,
): Promise<FillOutcome> {
  const doc = await load(bytes);
  if (!doc || doc === 'encrypted') throw new Error('PDF_UNREADABLE');
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const written: string[] = [];
  const failed: FillOutcome['failed'] = [];
  for (const w of writes) {
    try {
      const field = form.getField(w.name);
      if (field instanceof PDFTextField) {
        if (typeof w.value !== 'string') throw new Error('not_text');
        // Valida a codificação ANTES de gravar: o pdf-lib só reclama ao gerar a aparência.
        font.encodeText(w.value);
        field.setText(w.value);
        field.updateAppearances(font);
      } else if (field instanceof PDFCheckBox) {
        if (typeof w.value !== 'boolean') throw new Error('not_boolean');
        if (w.value) field.check();
        else field.uncheck();
        field.updateAppearances();
      } else if (field instanceof PDFDropdown) {
        if (typeof w.value !== 'string') throw new Error('not_text');
        font.encodeText(w.value);
        field.select(w.value);
        field.updateAppearances(font);
      } else if (field instanceof PDFOptionList) {
        if (typeof w.value !== 'string') throw new Error('not_text');
        field.select(w.value);
        field.updateAppearances(font);
      } else if (field instanceof PDFRadioGroup) {
        if (typeof w.value !== 'string') throw new Error('not_text');
        field.select(w.value);
        field.updateAppearances();
      } else {
        throw new Error('unsupported');
      }
      written.push(w.name);
    } catch (err) {
      failed.push({ name: w.name, error: err instanceof Error ? err.message : 'error' });
    }
  }
  // As aparências dos campos escritos já foram geradas acima; não mexe nos demais campos.
  return { bytes: await doc.save({ updateFieldAppearances: false }), written, failed };
}
