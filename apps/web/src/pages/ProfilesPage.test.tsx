import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';

const api = vi.fn();
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  api: (...a: unknown[]) => api(...a),
}));
let pii = true;
let consent = true;
const mutate = vi.fn();
vi.mock('../lib/queries', () => ({
  useHealth: () => ({ data: { pii: { configured: pii } } }),
  usePiiConsent: () => ({ data: consent }),
  usePiiConsentMutation: () => ({ mutate, isPending: false }),
  useProfiles: () => ({
    data: { profiles: [{ id: 'p1', label: 'Pessoal', updatedAt: 1 }], max: 10 },
  }),
}));

import { ProfilesPage } from './ProfilesPage';

function renderPage() {
  void i18n.changeLanguage('pt');
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ProfilesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  pii = true;
  consent = true;
  api.mockReset();
  mutate.mockReset();
});

describe('ProfilesPage', () => {
  it('sem chave de criptografia no servidor, avisa e não deixa criar nem consentir', () => {
    pii = false;
    consent = false;
    renderPage();
    expect(screen.getByText(/chave de criptografia não está configurada/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Novo perfil' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Autorizar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('sem consentimento não cria nem edita, mas ainda exporta e exclui', () => {
    consent = false;
    renderPage();
    expect(
      (screen.getByRole('button', { name: 'Novo perfil' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Editar' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Exportar' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('button', { name: 'Excluir' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Autorizar' }));
    expect(mutate).toHaveBeenCalledWith(true);
  });

  it('valida no navegador antes de enviar (CPF inválido) e envia o válido', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Novo perfil' }));
    fireEvent.change(screen.getByLabelText('Nome do perfil'), { target: { value: 'Casa' } });
    fireEvent.change(screen.getByLabelText('CPF'), { target: { value: '111.444.777-36' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));
    expect(await screen.findByText(/Valor inválido: CPF/)).toBeTruthy();
    expect(api).not.toHaveBeenCalled();

    api.mockResolvedValue({});
    fireEvent.change(screen.getByLabelText('CPF'), { target: { value: '111.444.777-35' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }));
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(api.mock.calls[0]?.[0]).toBe('/me/profiles');
    expect(api.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: { label: 'Casa' } });
  });

  it('excluir pede confirmação e envia confirm:true', async () => {
    api.mockResolvedValue({ deleted: true });
    const spy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/me/profiles/p1', {
        method: 'DELETE',
        body: { confirm: true },
      }),
    );
    spy.mockRestore();
  });
});
