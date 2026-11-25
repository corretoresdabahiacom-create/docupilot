import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';
import { ApiError } from '../lib/api';

const api = vi.fn();
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  api: (...a: unknown[]) => api(...a),
}));

import { InvitePage } from './InvitePage';
import { takePendingInvite } from '../lib/team';

function renderPage(signedIn: boolean) {
  void i18n.changeLanguage('pt');
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/convite/tok-123']}>
        <Routes>
          <Route path="/convite/:token" element={<InvitePage signedIn={signedIn} />} />
          <Route path="/" element={<p>inicio</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const preview = {
  invite: {
    organizationName: 'Acme',
    workspaceName: 'Geral',
    role: 'editor',
    expiresAt: Date.now() + 1000,
  },
};

beforeEach(() => {
  api.mockReset();
  sessionStorage.clear();
});

describe('InvitePage', () => {
  it('convite inválido: mensagem única, sem detalhes', async () => {
    api.mockRejectedValue(new ApiError('NOT_FOUND', 404));
    renderPage(true);
    expect(await screen.findByText(/não é válido/i)).toBeTruthy();
  });

  it('sem login: mostra a prévia e guarda o convite ao ir entrar', async () => {
    api.mockResolvedValue(preview);
    renderPage(false);
    expect(await screen.findByText(/Acme/)).toBeTruthy();
    fireEvent.click(screen.getByText('Entrar'));
    expect(takePendingInvite()).toBe('tok-123');
  });

  it('logado: aceita e vai para o início', async () => {
    api.mockImplementation((path: string) =>
      path.startsWith('/invites/accept')
        ? Promise.resolve({ workspace: { id: 'w9' } })
        : Promise.resolve(preview),
    );
    renderPage(true);
    fireEvent.click(await screen.findByText('Aceitar convite'));
    await waitFor(() => expect(screen.getByText('inicio')).toBeTruthy());
    expect(api).toHaveBeenCalledWith('/invites/accept', {
      method: 'POST',
      body: { token: 'tok-123' },
    });
  });

  it('erro ao aceitar (ex.: limite de membros) é exibido', async () => {
    api.mockImplementation((path: string) =>
      path.startsWith('/invites/accept')
        ? Promise.reject(new ApiError('QUOTA_EXCEEDED', 429))
        : Promise.resolve(preview),
    );
    renderPage(true);
    fireEvent.click(await screen.findByText('Aceitar convite'));
    expect(await screen.findByText(/Quota/)).toBeTruthy();
  });
});
