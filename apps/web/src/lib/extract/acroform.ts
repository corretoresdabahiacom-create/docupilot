import type { AcroFormFieldInfo } from '@docupilot/shared';
import { openPdf } from '../pdf';

/** Bit "Required" do campo de formulário (ISO 32000, tabela 226). */
const REQUIRED_FLAG = 2;

function isFilled(value: unknown, fieldType: string | undefined): boolean {
  if (Array.isArray(value)) return value.some((v) => isFilled(v, fieldType));
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return v !== '' && !(fieldType === 'Btn' && v.toLowerCase() === 'off');
}

/**
 * Lê os campos de formulário (AcroForm) via pdf.js, no navegador. Só devolve o que o próprio PDF
 * declara (nome, obrigatório, preenchido); assinaturas e botões de ação ficam de fora.
 * Qualquer falha devolve lista vazia: a regra de campos obrigatórios simplesmente não roda.
 */
export async function readAcroForm(blob: Blob): Promise<AcroFormFieldInfo[]> {
  let pdf;
  try {
    pdf = await openPdf(await blob.arrayBuffer());
  } catch {
    return [];
  }
  const out: AcroFormFieldInfo[] = [];
  try {
    for (let n = 1; n <= Math.min(pdf.numPages, 300); n++) {
      const page = await pdf.getPage(n);
      const annotations = (await page.getAnnotations()) as Array<{
        subtype?: string;
        fieldType?: string;
        fieldName?: string;
        fieldValue?: unknown;
        fieldFlags?: number;
        pushButton?: boolean;
      }>;
      for (const a of annotations) {
        if (a.subtype !== 'Widget' || !a.fieldName) continue;
        if (a.fieldType === 'Sig' || a.pushButton) continue;
        out.push({
          pageNumber: n,
          name: a.fieldName.slice(0, 200),
          required: ((a.fieldFlags ?? 0) & REQUIRED_FLAG) !== 0,
          filled: isFilled(a.fieldValue, a.fieldType),
        });
      }
      page.cleanup();
      if (out.length >= 200) break;
    }
  } catch {
    return [];
  } finally {
    await pdf.loadingTask.destroy();
  }
  return out.slice(0, 200);
}
