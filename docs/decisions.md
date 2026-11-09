# Decisões de arquitetura — DocuPilot AI

Registro das decisões tomadas ao final da Fase 0 (2026-11-09). Todas respeitam R1 (custo zero, sem cartão).

## D1. Extração de texto roda no navegador

`pdfjs-dist` (PDF) e `mammoth` (DOCX) rodam no cliente. O servidor recebe o texto já extraído por página, valida tamanho e formato e grava. Motivo: o Workers Free tem 10 ms de CPU por requisição, insuficiente para parsear PDFs no servidor.

- O servidor **não confia** no texto enviado: hash do arquivo (SHA-256) e tamanho real são conferidos contra o objeto no armazenamento; o texto fica marcado `extracted_by = 'client'`.
- Regex/heurísticas leves (CPF, CNPJ, datas) também rodam no cliente; o resultado é validado por esquema (`zod`) no servidor.
- `unpdf` sai da stack do servidor. Fica proibido parsear PDF dentro do Worker.

## D2. Armazenamento de arquivos: interface `StorageProvider`

Interface única (`createUploadUrl`, `head`, `readRange`, `createDownloadUrl`, `delete`) com duas implementações.

| Provedor                                       | Papel       | Observação                                                                                                                            |
| ---------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare R2 (via `aws4fetch`, presigned PUT) | Alvo padrão | 10 GB, egress gratuito. **A ativação passa por um checkout; não foi confirmado em fonte oficial se pede cartão.**                     |
| Supabase Storage                               | Plano B     | 1 GB, 5 GB de banda/mês; um artigo de terceiros cita limite de 50 MB por arquivo (não confirmado). Projeto pausa após 7 dias sem uso. |

Regra: o usuário ativa o R2 por conta própria (criar conta e inserir dados de pagamento é ação proibida para o agente). Se o checkout exigir cartão, o provedor passa a ser o Supabase Storage, sem mudar o restante do código. Enquanto nenhum provedor estiver configurado, a UI mostra "armazenamento não configurado" (R4).

Como o R2 não tem teto rígido, o limite é aplicado **pela aplicação**: teto global de 8 GB (80% dos 10 GB).

## D3. Rate limit

Em camadas, sem gastar escritas de KV nem de D1:

1. **Rate Limiting binding** do Workers (janelas de 10 ou 60 s; aproximado e por localização). Disponibilidade no plano Free **não confirmada na documentação**; será testada na Fase 1 e, se indisponível, esta camada é removida.
2. **Turnstile** em cadastro, login, upload e `/report`.
3. **Contador de falhas de login no D1** (uma escrita só quando há falha), com bloqueio temporário por conta.

Proibido usar KV para contadores (1.000 escritas/dia).

## D4. Quotas ajustadas ao free tier

Configuráveis em `system_settings`, com teto global além do por workspace.

| Quota                                  | Briefing | Decidido                |
| -------------------------------------- | -------- | ----------------------- |
| Armazenamento por workspace            | 5 GB     | 1 GB                    |
| Armazenamento global                   | n/d      | 8 GB                    |
| Tamanho por arquivo                    | 100 MB   | 25 MB                   |
| Documentos por workspace               | 500      | 200                     |
| Extrações por mês                      | 1.000    | 300                     |
| Exportações por mês                    | 200      | 100                     |
| Membros por workspace                  | 20       | 5                       |
| Escritas D1 por dia (orçamento global) | n/d      | 80.000 (80% de 100.000) |

Ao se aproximar do orçamento de escritas, operações não essenciais são recusadas com `QUOTA_EXCEEDED`.

## D5. Limites de execução

- Máximo de 40 queries D1 por requisição (limite da plataforma: 50); gravações em lote.
- Máximo de 40 subrequests por requisição (limite: 50).
- Limpeza de retenção em cron: lotes pequenos, no máximo 5 triggers na conta.
- Hash de senha: PBKDF2 via Web Crypto (nativo). O custo de CPU em 10 ms será medido na Fase 1; o número de iterações fica configurável e documentado.

## D6. GitHub

O repositório `corretoresdabahiacom-create/docupilot` recebe o código ao final de cada fase, com autorização explícita do usuário para push.
