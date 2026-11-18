import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../i18n';

const api = vi.fn();
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  api: (...a: unknown[]) => api(...a),
}));

let personal = true;
let role = 'owner';
let execution: Record<string, unknown> = {};
vi.mock('../lib/creation', async (orig) => ({
  ...(await orig<typeof import('../lib/creation')>()),
  useWorkspace: () => ({ id: 'w1', role, personal }),
  useGenerated: () => ({ data: { documents: [], max: 200 }, isPending: false }),
  useWorkflows: () => ({
    data: { workflows: [{ id: 'f1', name: 'Fluxo A', steps: 3, updatedAt: 1 }], max: 50 },
    isPending: false,
  }),
  useWorkflow: () => ({ data: { id: 'f1', name: 'Fluxo A', steps: [], inputs: ['primary'] } }),
  useExecution: () => ({ data: execution, isPending: false, isError: false }),
  useNotifications: () => ({ data: { notifications: [], unread: 0 }, isPending: false }),
}));
vi.mock('../lib/queries', async (orig) => ({
  ...(await orig<typeof import('../lib/queries')>()),
  useAllDocuments: () => ({ data: { documents: [{ id: 'd1', name: 'contrato.pdf' }] } }),
}));

import { CreatePage } from './CreatePage';
import { ExecutionPage } from './ExecutionPage';
import { WorkflowsPage } from './WorkflowsPage';

function renderAt(ui: React.ReactElement, path = '/') {
  void i18n.changeLanguage('pt');
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={ui} />
          <Route path="/workflows/executions/:eid" element={ui} />
          <Route path="/create/:id" element={<p>editor</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.mockReset();
  personal = true;
  role = 'owner';
  execution = {
    id: 'e1',
    workflowId: 'f1',
    workflowName: 'Fluxo A',
    status: 'awaiting_approval',
    startedAt: 1,
    finishedAt: null,
    startedBy: 'u1',
    usedMs: 10,
    steps: [
      { position: 1, kind: 'input_extract' },
      { position: 2, kind: 'approval' },
    ],
    log: [
      {
        position: 1,
        kind: 'input_extract',
        status: 'completed',
        attempts: 1,
        startedAt: 1,
        finishedAt: 2,
        result: { fields: 4, inconsistencies: 0 },
      },
      {
        position: 2,
        kind: 'approval',
        status: 'awaiting_approval',
        attempts: 1,
        startedAt: 2,
        finishedAt: 2,
      },
    ],
  };
});

describe('CreatePage', () => {
  it('avisa que modelos não têm validação jurídica e cria com os valores digitados', async () => {
    api.mockResolvedValue({ id: 'g1' });
    renderAt(<CreatePage />);
    fireEvent.click(screen.getByRole('button', { name: /Proposta/ }));
    expect(screen.getAllByText(/NÃO têm validação jurídica/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText(/Cliente/), { target: { value: 'ACME' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar a partir do modelo/ }));
    await waitFor(() => expect(api).toHaveBeenCalled());
    const [path, opts] = api.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(path).toBe('/workspaces/w1/generated');
    expect(opts.body).toMatchObject({ template: 'proposta', values: { cliente: 'ACME' } });
    expect(await screen.findByText('editor')).toBeTruthy();
  });
});

describe('ExecutionPage — aprovação', () => {
  it('workspace pessoal: só confirma com a caixa de irreversibilidade marcada', async () => {
    api.mockResolvedValue({});
    renderAt(<ExecutionPage />, '/workflows/executions/e1');
    expect(screen.getByText(/Aguardando aprovação/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Aprovar…/ }));
    const dialog = screen.getByRole('dialog');
    const submit = screen.getByRole('button', { name: 'Confirmar' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.textContent).toMatch(/não pode ser desfeita/);
    fireEvent.click(screen.getByRole('checkbox'));
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(api).toHaveBeenCalled());
    const [path, opts] = api.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(path).toBe('/workspaces/w1/workflow-executions/e1/decision');
    expect(opts.body).toMatchObject({ decision: 'approved', confirm: true });
  });

  it('rejeitar não exige a confirmação irreversível', async () => {
    api.mockResolvedValue({});
    renderAt(<ExecutionPage />, '/workflows/executions/e1');
    fireEvent.click(screen.getByRole('button', { name: /Rejeitar…/ }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(
      (api.mock.calls[0] as [string, { body: Record<string, unknown> }])[1].body,
    ).toMatchObject({
      decision: 'rejected',
    });
  });

  it('sem permissão de aprovar, não mostra os botões de decisão', () => {
    role = 'editor';
    renderAt(<ExecutionPage />, '/workflows/executions/e1');
    expect(screen.queryByRole('button', { name: /Aprovar…/ })).toBeNull();
    expect(screen.getByText(/não tem permissão para aprovar/)).toBeTruthy();
  });

  it('mostra falha com a mensagem do passo, sem esconder o motivo', () => {
    execution = {
      ...execution,
      status: 'failed',
      log: [
        {
          position: 1,
          kind: 'input_extract',
          status: 'failed',
          attempts: 1,
          startedAt: 1,
          finishedAt: 2,
          error: 'o documento da entrada "primary" não tem análise atualizada; analise-o antes',
        },
      ],
    };
    renderAt(<ExecutionPage />, '/workflows/executions/e1');
    expect(screen.getByText(/não tem análise atualizada/)).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('WorkflowsPage — criação', () => {
  it('recusa ordem inválida antes de chamar a API e lista o workflow existente', async () => {
    renderAt(<WorkflowsPage />);
    expect(screen.getByText('Fluxo A')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Novo workflow' }));
    fireEvent.change(screen.getByLabelText('Nome do workflow'), { target: { value: 'X' } });
    // remove o passo de leitura e deixa só "Validar"
    fireEvent.click(screen.getByRole('button', { name: 'Remover passo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText(/Ordem dos passos inválida/)).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });

  it('cria um workflow válido e não oferece passos externos', async () => {
    api.mockResolvedValue({ id: 'new' });
    renderAt(<WorkflowsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Novo workflow' }));
    const options = Array.from(
      (screen.getByLabelText('Adicionar passo') as HTMLSelectElement).options,
    ).map((o) => o.value);
    expect(options).toEqual([
      'input_extract',
      'validate',
      'compare',
      'generate',
      'approval',
      'output',
    ]);
    fireEvent.change(screen.getByLabelText('Nome do workflow'), { target: { value: 'Meu fluxo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(api).toHaveBeenCalled());
    const [path, opts] = api.mock.calls[0] as [
      string,
      { body: { steps: Array<{ kind: string }> } },
    ];
    expect(path).toBe('/workspaces/w1/workflows');
    expect(opts.body.steps.map((s) => s.kind)).toEqual(['input_extract']);
  });
});
