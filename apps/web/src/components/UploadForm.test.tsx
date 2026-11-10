import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';

const precheckUpload = vi.fn();
const uploadFile = vi.fn();
vi.mock('../lib/upload', () => ({
  precheckUpload: (...a: unknown[]) => precheckUpload(...a),
  uploadFile: (...a: unknown[]) => uploadFile(...a),
}));

import { UploadForm } from './UploadForm';

const SHA = 'a'.repeat(64);
const uploaded = {
  documentId: 'd1',
  versionId: 'v1',
  versionNumber: 1,
  mime: 'application/pdf',
  status: 'extracted',
};

function renderForm(props: { documentId?: string } = {}) {
  void i18n.changeLanguage('pt');
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <UploadForm workspaceId="w1" storageReady {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function pick(name = 'a.pdf') {
  const input = screen.getByLabelText('Escolher arquivo') as HTMLInputElement;
  const file = new File(['%PDF-1.7'], name, { type: 'application/pdf' });
  fireEvent.change(input, { target: { files: [file] } });
  // jsdom não reconhece `files` injetado como valor do campo `required`; envia o formulário direto.
  fireEvent.submit(input.form!);
}

beforeEach(() => {
  precheckUpload.mockReset();
  uploadFile.mockReset();
  uploadFile.mockResolvedValue(uploaded);
});

describe('UploadForm', () => {
  it('envia direto quando não há duplicado nem documento de mesmo nome', async () => {
    precheckUpload.mockResolvedValue({ sha256: SHA, duplicate: null, sameName: null });
    renderForm();
    pick();
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    expect(uploadFile.mock.calls[0]![2]).toMatchObject({ sha256: SHA, allowDuplicate: undefined });
  });

  it('arquivo idêntico: avisa e só envia se o usuário confirmar', async () => {
    precheckUpload.mockResolvedValue({
      sha256: SHA,
      duplicate: { documentId: 'd0', name: 'contrato.pdf' },
      sameName: null,
    });
    renderForm();
    pick();
    expect(await screen.findByRole('alert')).toHaveTextContent('contrato.pdf');
    expect(uploadFile).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Abrir o existente' })).toHaveAttribute(
      'href',
      '/documents/d0',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mesmo assim' }));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    expect(uploadFile.mock.calls[0]![2]).toMatchObject({ allowDuplicate: true });
  });

  it('mesmo nome com conteúdo diferente: oferece nova versão', async () => {
    precheckUpload.mockResolvedValue({
      sha256: SHA,
      duplicate: null,
      sameName: { documentId: 'd9', name: 'ata.pdf' },
    });
    renderForm();
    pick('ata.pdf');
    fireEvent.click(await screen.findByRole('button', { name: 'Enviar como nova versão' }));
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    expect(uploadFile.mock.calls[0]![2]).toMatchObject({ documentId: 'd9' });
  });

  it('cancelar descarta o aviso sem enviar', async () => {
    precheckUpload.mockResolvedValue({
      sha256: SHA,
      duplicate: { documentId: 'd0', name: 'x.pdf' },
      sameName: null,
    });
    renderForm();
    pick();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('no modo nova versão não pergunta sobre nome repetido', async () => {
    precheckUpload.mockResolvedValue({
      sha256: SHA,
      duplicate: null,
      sameName: { documentId: 'd9', name: 'ata.pdf' },
    });
    renderForm({ documentId: 'd9' });
    pick('ata.pdf');
    await waitFor(() => expect(uploadFile).toHaveBeenCalledTimes(1));
    expect(uploadFile.mock.calls[0]![2]).toMatchObject({ documentId: 'd9' });
  });

  it('mostra a mensagem traduzida de erro da API', async () => {
    precheckUpload.mockResolvedValue({ sha256: SHA, duplicate: null, sameName: null });
    const { ApiError } = await import('../lib/api');
    uploadFile.mockRejectedValue(new ApiError('FILE_TOO_LARGE', 413));
    renderForm();
    pick();
    expect(await screen.findByRole('alert')).toHaveTextContent('Arquivo acima do limite');
  });
});
