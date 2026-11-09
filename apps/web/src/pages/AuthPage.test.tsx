import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import i18n from '../i18n';
import { AuthPage } from './AuthPage';

afterEach(() => vi.unstubAllGlobals());

function renderPage(mode: 'login' | 'register') {
  void i18n.changeLanguage('pt');
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <AuthPage mode={mode} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AuthPage', () => {
  it('mostra mensagem traduzida quando o servidor recusa as credenciais', async () => {
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'x' } }), {
          status: 401,
        }),
    );
    renderPage('login');
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'qualquer-senha-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha inválidos');
  });

  it('cadastro exige senha de pelo menos 12 caracteres no formulário', () => {
    renderPage('register');
    expect(screen.getByLabelText('Senha')).toHaveAttribute('minlength', '12');
  });

  it('envia nome, e-mail e senha no cadastro', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage('register');
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ana' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'ana@example.com' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'uma senha bem longa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth/register');
    expect(JSON.parse(init.body as string)).toMatchObject({
      displayName: 'Ana',
      email: 'ana@example.com',
    });
  });
});
