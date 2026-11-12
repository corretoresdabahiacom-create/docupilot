import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';

const readFormFields = vi.fn();
const fillPdf = vi.fn();
vi.mock('../lib/form', () => ({
  readFormFields: (...a: unknown[]) => readFormFields(...a),
  fillPdf: (...a: unknown[]) => fillPdf(...a),
}));
vi.mock('../lib/documents', () => ({
  fetchDocumentBlob: async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }),
}));
const saveBlob = vi.fn();
const loadProfile = vi.fn();
vi.mock('../lib/fill', async (orig) => ({
  ...(await orig<typeof import('../lib/fill')>()),
  saveBlob: (...a: unknown[]) => saveBlob(...a),
  loadProfile: (...a: unknown[]) => loadProfile(...a),
  loadReferenceSources: async () => [],
}));

let mime = 'application/pdf';
vi.mock('../lib/queries', () => ({
  useMe: () => ({ isPending: false, data: { workspaces: [{ id: 'w1', role: 'owner' }] } }),
  useDocument: () => ({
    isPending: false,
    data: {
      document: { id: 'd1', name: 'Ficha.pdf', mime, currentVersionId: 'v1' },
      versions: [],
    },
  }),
  useAllDocuments: () => ({ data: { documents: [{ id: 'd1', name: 'Ficha.pdf' }] } }),
  useProfiles: () => ({ data: { profiles: [{ id: 'p1', label: 'Pessoal' }], max: 10 } }),
}));

import { FillFormPage } from './FillFormPage';

const text = (name: string, over = {}) => ({ name, pdfType: 'text', value: null, ...over });

function renderPage() {
  void i18n.changeLanguage('pt');
  return render(
    <MemoryRouter initialEntries={['/documents/d1/fill']}>
      <Routes>
        <Route path="/documents/:documentId/fill" element={<FillFormPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function ready() {
  renderPage();
  await screen.findByText('Fontes dos dados');
  fireEvent.change(screen.getByLabelText('Perfil de dados pessoais'), { target: { value: 'p1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Usar este perfil' }));
  await screen.findByText(/Perfil “Pessoal” carregado/);
  fireEvent.click(screen.getByRole('button', { name: 'Montar proposta' }));
}

beforeEach(() => {
  mime = 'application/pdf';
  readFormFields.mockReset();
  fillPdf.mockReset();
  saveBlob.mockReset();
  loadProfile.mockReset();
  readFormFields.mockResolvedValue({
    ok: true,
    hasXfa: false,
    fields: [
      text('CPF'),
      text('Observações'),
      text('Cônjuge.CPF'),
      text('Nome Completo', { required: true }),
    ],
  });
  loadProfile.mockResolvedValue({ id: 'p1', label: 'Pessoal', fields: { cpf: '11144477735' } });
  fillPdf.mockResolvedValue({ bytes: new Uint8Array([1]), written: ['CPF'], failed: [] });
});

describe('FillFormPage', () => {
  it('propõe sem escrever nada; campo ausente e de outra pessoa ficam em branco', async () => {
    await ready();
    expect(await screen.findByText('Sugerido (perfil)')).toBeTruthy();
    expect(screen.getAllByText('Em branco').length).toBe(3);
    expect(screen.getByText(/não preenchido/)).toBeTruthy(); // motivo "outra pessoa"
    expect(screen.getByText(/Obrigatórios que ficarão em branco: Nome Completo/)).toBeTruthy();
    const generate = screen.getByRole('button', { name: 'Gerar PDF preenchido' });
    expect((generate as HTMLButtonElement).disabled).toBe(true); // nada confirmado ainda
    expect(fillPdf).not.toHaveBeenCalled();
  });

  it('confirmar e gerar escreve só o confirmado e lista o que ficou em branco', async () => {
    await ready();
    fireEvent.click(
      await screen.findByRole('button', { name: /Confirmar todos os sugeridos \(1\)/ }),
    );
    expect(screen.getByText(/1 confirmado/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gerar PDF preenchido' }));
    await waitFor(() => expect(fillPdf).toHaveBeenCalledTimes(1));
    expect(fillPdf.mock.calls[0]?.[1]).toEqual([{ name: 'CPF', value: '111.444.777-35' }]);
    await screen.findByText(/PDF gerado com 1 campo/);
    expect(saveBlob).toHaveBeenCalledWith(
      expect.anything(),
      'Ficha-preenchido.pdf',
      'application/pdf',
    );
    expect(
      screen.getByText(/Ficaram em branco: Observações, Cônjuge.CPF, Nome Completo/),
    ).toBeTruthy();
  });

  it('digitar um valor inválido não confirma; válido entra com origem manual', async () => {
    await ready();
    const input = await screen.findByLabelText('Digitar valor: CPF');
    fireEvent.change(input, { target: { value: '111.444.777-36' } });
    fireEvent.click(input.parentElement!.querySelector('button')!);
    expect(await screen.findByText('formato inválido')).toBeTruthy();
    fireEvent.change(input, { target: { value: '111.444.777-35' } });
    fireEvent.click(input.parentElement!.querySelector('button')!);
    await screen.findByText('Confirmado');
    expect(screen.getByText(/Origem: manual/)).toBeTruthy();
  });

  it.each([
    ['encrypted', { ok: false, reason: 'encrypted' }, /protegido por senha/],
    ['invalid', { ok: false, reason: 'invalid' }, /Não foi possível ler este PDF/],
    ['sem campos', { ok: true, hasXfa: false, fields: [] }, /não tem campos de formulário/],
  ])('avisa quando o PDF é %s', async (_n, result, msg) => {
    readFormFields.mockResolvedValue(result);
    renderPage();
    expect(await screen.findByText(msg)).toBeTruthy();
    expect(screen.queryByText('Fontes dos dados')).toBeNull();
  });

  it('avisa sobre XFA', async () => {
    readFormFields.mockResolvedValue({ ok: true, hasXfa: true, fields: [text('CPF')] });
    renderPage();
    expect(await screen.findByText(/formulário XFA/)).toBeTruthy();
  });

  it('não-PDF é recusado sem tentar ler', async () => {
    mime = 'image/png';
    renderPage();
    expect(await screen.findByText('Só é possível preencher PDFs.')).toBeTruthy();
    expect(readFormFields).not.toHaveBeenCalled();
  });
});
