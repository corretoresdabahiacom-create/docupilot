# DocuPilot AI

Plataforma multi-tenant para organizar, extrair, comparar, preencher e gerar documentos, com rastreabilidade de origem e revisão humana. **Sem IA generativa por padrão**: o que é extração determinística, heurística ou IA é sempre declarado.

> Estado: **Fase 6 (criação e automação)** concluída, aguardando aprovação. As Fases 2, 3, 4 e 5 seguem com aprovação formal pendente. Siga as fases em ordem; cada uma termina com aprovação.

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

## Fase 6 (criação e automação)

- **Criar documentos** (`/create`): editor Tiptap (títulos, listas, citações, tabelas, imagens embutidas, links), 10 modelos de texto com campos `{{chave}}` (**sem validação jurídica**; campo vazio continua visível), versão otimista e exportação para PDF, DOCX, HTML, Markdown e TXT gerada no navegador (layout simples; para layout complexo, HTML + imprimir).
- **Workflows** (`/workflows`): fluxos lineares de até 10 passos (ler campos extraídos, validar, comparar campos, gerar documento, aprovação humana, resumo), sem passos externos, com tempo total de 5 min, 30 s por passo e até 2 novas tentativas em falha transitória. A aprovação pausa a execução: em workspace pessoal exige confirmação em duas etapas; em equipe, quem iniciou não aprova. Tudo fica registrado em `approvals` e na auditoria.
- **Notificações** (`/notifications`): só dentro do app, sem Web Push.
- Detalhes e limites: `docs/decisions.md` (D15), `docs/limitations.md`.
