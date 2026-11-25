# DocuPilot AI

Plataforma multi-tenant para organizar, extrair, comparar, preencher e gerar documentos, com rastreabilidade de origem e revisão humana. **Sem IA generativa por padrão**: o que é extração determinística, heurística ou IA é sempre declarado.

> Estado: **Fase 8 (administração e validação)** concluída, aguardando aprovação. É a última fase do plano. As Fases 2 a 7 seguem com aprovação formal pendente. Siga as fases em ordem; cada uma termina com aprovação.

## Estrutura

```
apps/api         Cloudflare Worker (Hono + Drizzle + Postgres/Supabase)
apps/web         React + Vite + Tailwind (PWA)
packages/shared  Papéis, quotas, validação de arquivos, esquemas zod
docs/            Decisões, limites do free tier, arquitetura, segurança
```

## Desenvolvimento

```bash
pnpm install
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @docupilot/web build
```

A API roda em Workers com **Postgres no Supabase** (driver `postgres.js` pelo pooler, porta 6543). Para usar: crie um projeto Supabase (plano Free), copie a connection string do **Transaction pooler**, aplique `apps/api/migrations/0000_*.sql` e `0001_*.sql` (SQL Editor do Supabase ou `psql`) e grave o segredo com `wrangler secret put DATABASE_URL`. Sem `DATABASE_URL` a API responde 503 `SERVICE_NOT_CONFIGURED` (só `/health` funciona). Em desenvolvimento use `DATABASE_URL` em `apps/api/.dev.vars` e `pnpm --filter @docupilot/api dev`; o front usa proxy para `localhost:8787` (`pnpm --filter @docupilot/web dev`). Os testes não precisam de Supabase: rodam em Postgres embutido (PGlite) com as mesmas migrações.

Teste de fumaça no navegador (Chromium): compile o front, suba `apps/api/e2e/server.ts` com `tsx` e rode `node apps/web/e2e/smoke.mjs` (Playwright não é dependência do repositório).

## Documentação

- [Decisões de arquitetura](docs/decisions.md)
- [Catálogo de heurísticas e padrões](docs/heuristics.md)
- [Limites do free tier Cloudflare](docs/free-tier-limits.md)
- [Arquitetura](docs/architecture.md) · [Segurança](docs/security.md) · [Variáveis de ambiente](docs/env-vars.md) · [Limitações](docs/limitations.md)

## Princípios

Custo zero, sem cartão. Nada é apresentado como operacional se não estiver configurado. Nunca inventar dado extraído. Nenhum parecer jurídico, contábil, médico ou fiscal. Nenhum documento enviado a terceiros sem consentimento registrado.

## Fase 8 (administração e validação)

- **Painel `/admin`** (só administrador da plataforma): totais, usuários (suspender/reativar), fila de denúncias, recursos (só desligar) e cotas. **Mostra apenas metadados**: nomes e conteúdo de documentos nunca aparecem. Quem não é admin recebe 404 na API e é redirecionado na tela.
- **Primeiro administrador**: não há rota para virar admin. Execute no banco: `UPDATE users SET is_platform_admin = true WHERE email = 'voce@exemplo.com';`.
- **Denúncia pública** em `/report` (sem login, Turnstile quando configurado, 5 por hora por origem; a resposta nunca revela se o conteúdo existe). Remoção de documento: avisar o dono, esperar 72 h e só então remover; remoção urgente exige motivo e fica auditada.
- **Retenção diária** (cron `0 4 * * *`): auditoria > 180 dias, sessões expiradas, convites usados/expirados > 30 dias, denúncias resolvidas > 180 dias, contadores de limite > 1 dia.
- **Validação**: varredura automática de **todas** as rotas da API (`apps/api/src/security.test.ts`): sem sessão → 401; não-membro → 404 em toda rota de workspace; leitor nunca altera dados; sem vazamento de pilha/SQL; CSRF e cookie. Fumaça no navegador com 64 verificações (inclui `/admin`, `/report` e celular a 390 px).

## Fase 7 (empresas)

- **Empresa**: `POST /organizations` cria a empresa e um workspace compartilhado (você é o proprietário). Telas em **Equipe** (`/team`); o seletor do topo troca de workspace (o pessoal vem primeiro).
- **Convites por link** (sem e-mail transacional): o papel e a validade (1 h a 30 dias) são definidos por quem convida; o token é aleatório, só o hash fica no banco, aparece **uma única vez**, vale **um único aceite** e pode ser revogado. Quem recebe vê só uma prévia (nomes e papel) em `/convite/:token`, entra ou cria conta e aceita.
- **Papéis**: matriz do briefing §4. Quem tem `manage_members` só concede/altera papéis abaixo do seu; ninguém concede `owner`; ninguém altera o próprio papel.
- **Pastas compartilhadas**: uma pasta pode ser **restrita** (vale para as subpastas). Só proprietário, administrador, gerente e membros com concessão (`view` ou `edit`) a veem; o papel do workspace continua limitando (um leitor com `edit` não edita).
- **Cota por membro**: bytes enviados por cada membro em workspace de empresa (padrão 256 MB; o administrador ajusta por membro).
- **Histórico por workspace**: eventos de auditoria (quem, o quê, quando; nunca conteúdo), visível a proprietário, administrador e gerente.

## Fase 6 (criação e automação)

- **Criar documentos** (`/create`): editor Tiptap (títulos, listas, citações, tabelas, imagens embutidas, links), 10 modelos de texto com campos `{{chave}}` (**sem validação jurídica**; campo vazio continua visível), versão otimista e exportação para PDF, DOCX, HTML, Markdown e TXT gerada no navegador (layout simples; para layout complexo, HTML + imprimir).
- **Workflows** (`/workflows`): fluxos lineares de até 10 passos (ler campos extraídos, validar, comparar campos, gerar documento, aprovação humana, resumo), sem passos externos, com tempo total de 5 min, 30 s por passo e até 2 novas tentativas em falha transitória. A aprovação pausa a execução: em workspace pessoal exige confirmação em duas etapas; em equipe, quem iniciou não aprova. Tudo fica registrado em `approvals` e na auditoria.
- **Notificações** (`/notifications`): só dentro do app, sem Web Push.
- Detalhes e limites: `docs/decisions.md` (D15), `docs/limitations.md`.
