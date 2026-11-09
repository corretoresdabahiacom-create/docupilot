# DocuPilot AI

Plataforma multi-tenant para organizar, extrair, comparar, preencher e gerar documentos, com rastreabilidade de origem e revisão humana. **Sem IA generativa por padrão**: o que é extração determinística, heurística ou IA é sempre declarado.

> Estado: **Fase 1 (fundação)** concluída. Siga as fases em ordem; cada uma termina com aprovação.

## Estrutura

```
apps/api         Cloudflare Worker (Hono + Drizzle + D1)
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

A API roda em Workers; para rodar localmente é preciso criar um D1 (`wrangler d1 create docupilot`), colocar o id em `apps/api/wrangler.toml`, aplicar as migrações (`wrangler d1 migrations apply docupilot --local`) e subir `pnpm --filter @docupilot/api dev`. O front usa proxy para `localhost:8787` (`pnpm --filter @docupilot/web dev`).

## Documentação

- [Decisões de arquitetura](docs/decisions.md)
- [Limites do free tier Cloudflare](docs/free-tier-limits.md)
- [Arquitetura](docs/architecture.md) · [Segurança](docs/security.md) · [Variáveis de ambiente](docs/env-vars.md) · [Limitações](docs/limitations.md)

## Princípios

Custo zero, sem cartão. Nada é apresentado como operacional se não estiver configurado. Nunca inventar dado extraído. Nenhum parecer jurídico, contábil, médico ou fiscal. Nenhum documento enviado a terceiros sem consentimento registrado.
