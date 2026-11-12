import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';

const fetchAllPages = vi.fn();
vi.mock('../lib/analysis', () => ({
  fetchAllPages: (...a: unknown[]) => fetchAllPages(...a),
}));

const detail = {
  document: { id: 'd1', name: 'Contrato.pdf', currentVersionId: 'v2' },
  versions: [
    { id: 'v2', versionNumber: 2, createdAt: 2 },
    { id: 'v1', versionNumber: 1, createdAt: 1 },
  ],
};
vi.mock('../lib/queries', () => ({
  useMe: () => ({ isPending: false, data: { workspaces: [{ id: 'w1', role: 'owner' }] } }),
  useAllDocuments: () => ({
    data: { documents: [{ id: 'd1', name: 'Contrato.pdf' }] },
  }),
  useDocument: (_ws: string, id?: string) => ({ data: id ? detail : undefined }),
}));

import { ComparePage } from './ComparePage';

const V1 =
  'CONTRATO\n1. Objeto\nPrestação de serviços.\n2. Preço\nValor total: R$ 1.000,00\nVencimento: 10/05/2026';
const V2 =
  'CONTRATO\n1. Objeto\nPrestação de serviços.\n2. Preço\nValor total: R$ 1.250,00\nVencimento: 15/06/2026\n3. Foro\nComarca da capital.';

function renderAt(url: string) {
  void i18n.changeLanguage('pt');
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ComparePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchAllPages.mockReset();
  fetchAllPages.mockImplementation(async (_w: string, _d: string, version: string) => [
    { pageNumber: 1, text: version === 'v1' ? V1 : V2 },
  ]);
});

describe('ComparePage', () => {
  it('compara duas versões e mostra texto, campos e cláusulas', async () => {
    renderAt('/compare?ld=d1&lv=v1&rd=d1&rv=v2');
    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }));

    expect(await screen.findByText(/linhas iguais/)).toBeTruthy();
    expect(fetchAllPages).toHaveBeenCalledWith('w1', 'd1', 'v1');
    expect(fetchAllPages).toHaveBeenCalledWith('w1', 'd1', 'v2');
    // texto: a linha alterada aparece com marcas de palavras (— e +)
    expect(screen.getAllByLabelText('linha em A').length).toBeGreaterThan(0);
    expect(screen.getByText('Comarca da capital.')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Campos' }));
    expect(screen.getAllByText('Alterado').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('2026-06-15')).toBeTruthy();
    expect(screen.getByText('1250.00 BRL')).toBeTruthy();

    fireEvent.click(screen.getByRole('tab', { name: 'Cláusulas' }));
    expect(screen.getByText('Adicionada')).toBeTruthy();
    expect(screen.getByText('Alterada')).toBeTruthy();
  });

  it('mostra o aviso de que não há parecer jurídico', () => {
    renderAt('/compare');
    expect(screen.getByText(/não avalia validade, efeito ou legalidade/)).toBeTruthy();
  });

  it('mesma versão nos dois lados: avisa e desabilita', () => {
    renderAt('/compare?ld=d1&lv=v1&rd=d1&rv=v1');
    expect(screen.getByText(/mesma versão/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Comparar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('lado sem texto extraído: mensagem clara, sem resultado', async () => {
    fetchAllPages.mockImplementation(async (_w: string, _d: string, version: string) =>
      version === 'v1' ? [] : [{ pageNumber: 1, text: V2 }],
    );
    renderAt('/compare?ld=d1&lv=v1&rd=d1&rv=v2');
    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(/não tem texto extraído/)).toBeTruthy();
    expect(screen.queryByText('Resultado')).toBeNull();
  });

  it('exporta CSV, JSON e Markdown sem enviar nada ao servidor', async () => {
    const blobs: Blob[] = [];
    const create = vi.fn((b: Blob) => {
      blobs.push(b);
      return 'blob:x';
    });
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() });
    renderAt('/compare?ld=d1&lv=v1&rd=d1&rv=v2');
    fireEvent.click(screen.getByRole('button', { name: 'Comparar' }));
    await screen.findByText(/linhas iguais/);
    const calls = fetchAllPages.mock.calls.length;

    for (const f of ['CSV', 'JSON', 'MD']) fireEvent.click(screen.getByRole('button', { name: f }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    expect(blobs.map((b) => b.type.split(';')[0])).toEqual([
      'text/csv',
      'application/json',
      'text/markdown',
    ]);
    const csv = await blobs[0]!.text();
    expect(csv).toContain('2026-05-10');
    expect(csv).toContain('2026-06-15');
    expect(fetchAllPages.mock.calls.length).toBe(calls);
  });
});
