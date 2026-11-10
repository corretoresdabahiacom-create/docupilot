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

## D7. Busca textual: FTS5 com alternativa em LIKE (Fase 2)

Tabela virtual `document_pages_fts` (FTS5, conteúdo externo sobre `document_pages`, tokenizer `unicode61 remove_diacritics 2`) mantida por três gatilhos (insert/delete/update). Ordenação por `bm25`, trecho com `snippet()` e marcadores de controle que a ingestão remove do texto. Só a **versão atual** de cada documento é pesquisada, sempre filtrando por workspace. Se o banco não tiver FTS5, a rota cai para `LIKE` (não ignora acentos, mais lenta; a interface avisa).

- Suporte a FTS5 no D1: confirmado na documentação oficial de SQL statements. **Não verificado**: custo em linhas escritas das tabelas sombra do FTS5 no D1 Free (100.000 escritas/dia) nem o comportamento em D1 real; só foi testado em libSQL local.
- O índice FTS5 é global ao banco; o filtro de workspace é aplicado depois do `MATCH`. Isolamento correto (testado), mas o custo de leitura cresce com o total do banco.
- Mitigações de custo: máx. 300 páginas por documento, 10 páginas por requisição, 5.000.000 de caracteres de texto por workspace, 300 extrações por mês.

## D8. Texto extraído por página ou seção

`document_pages` guarda o texto por página (PDF/OCR) ou por **seção** (DOCX, TXT, MD, CSV, que não têm páginas reais; ~6.000 caracteres). O servidor nunca confia no cliente: higieniza caracteres de controle, limita tamanho e recusa texto com sinais inequívocos de corrupção. `document_metadata.extracted_by` diz se veio da camada de texto (`client`) ou de OCR (`client_ocr`). PDF sem texto → `needs_ocr`; PDF com texto ilegível → `extraction_failed`.

## D9. Duplicados e versões

- Mesmo SHA-256 no workspace: `409 DUPLICATE_FILE` com o documento existente; `allowDuplicate` permite enviar mesmo assim. `POST /uploads/precheck` avisa antes do envio e também sugere "nova versão" quando o nome já existe na pasta com conteúdo diferente.
- Nova versão: envio com `documentId`; máximo de 50 versões (`QUOTA_EXCEEDED`). A nova versão vira a atual e o documento volta para `needs_text`. É possível tornar atual uma versão antiga e excluir versões não atuais.
- Limitação: `document_metadata` é por documento, não por versão; ao trocar a versão atual ele é recalculado só com contagem de páginas e caracteres.

## D10. OCR no navegador: opt-in e consentimento

tesseract.js no cliente, só em desktop (verificação feita no navegador; o servidor não consegue confirmar o dispositivo), até 10 páginas por execução e imagens até 5 MB. O consentimento fica em `user_consents` (revogável) e o **servidor recusa** texto `client_ocr` sem consentimento ativo (`CONSENT_REQUIRED`). O documento não sai do computador, mas por padrão o tesseract.js baixa **worker, núcleo WASM e idiomas do jsDelivr** (verificado no código da biblioteca); `VITE_OCR_WORKER_PATH`, `VITE_OCR_CORE_PATH` e `VITE_OCR_LANG_PATH` permitem hospedar cópias próprias.

## D11. Exclusão

Documento: o banco é limpo primeiro (páginas, índice, hashes, metadados, versões) e os objetos depois. Se a remoção no armazenamento falhar, sobram objetos órfãos (custo), nunca documentos apontando para arquivo inexistente; a resposta traz `storageCleaned`. Faxina de órfãos por cron fica para fase posterior. Pasta só é excluída se estiver vazia.
