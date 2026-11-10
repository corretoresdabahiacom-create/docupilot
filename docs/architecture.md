# Arquitetura (Fase 2)

```
Navegador (React PWA)
  ├─ extração de texto no cliente (pdfjs-dist, mammoth, OCR opcional com tesseract.js)   [decisão D1]
  ├─ PUT direto no armazenamento (URL assinada)
  └─ /api/*  ──►  Worker (Hono)  ──►  D1 (Drizzle)
                        └────────►  StorageProvider (R2 | Supabase | não configurado)
```

## Hierarquia

`organization → workspace → folder (até 5 níveis) → document → versions`. Usuário individual = 1 organização pessoal + 1 workspace pessoal, criados no cadastro.

## Cadeia de autorização

1. `csrfOrigin`: verifica `Origin` (ou `X-Requested-With`) nas requisições que alteram estado.
2. `requireAuth`: resolve a sessão pelo cookie (hash do token no banco) e rotaciona após 24 h.
3. `requireWorkspacePermission(perm)`: não-membro recebe **404**; membro sem permissão recebe **403**.

## Upload

1. `POST /api/workspaces/:id/uploads`: valida corpo, Turnstile, quotas, pasta; grava `uploads` pendente; devolve URL assinada (TTL 5 min) com checksum SHA-256 assinado.
2. Cliente envia o arquivo direto ao armazenamento (o corpo nunca passa pelo Worker).
3. `POST .../uploads/:uploadId/complete`: confere tamanho real, lê início/fim do objeto, valida magic bytes contra o tipo declarado, reaplica quotas; só então cria `document`, `document_version` e `document_hashes`. Se inválido, o objeto é **excluído**.

## Extração, busca e versões (Fase 2)

1. Após o envio validado, o navegador extrai o texto do arquivo local (PDF: camada de texto; DOCX/TXT/MD/CSV: texto bruto) e o envia em lotes (`PUT .../versions/:id/pages`, até 10 páginas e 150.000 caracteres por lote).
2. `POST .../extraction/complete` fixa o estado (`extracted`, `needs_ocr` ou `extraction_failed`), grava metadados e conta a extração do mês.
3. A busca (`GET /workspaces/:id/search`) usa FTS5 sobre a versão atual e devolve documento, página/seção e trecho.
4. Pastas (`/folders`, até 5 níveis, 200 por workspace), documentos (renomear, mover, excluir), versões (tornar atual, excluir) e URLs de download assinadas (15 min) completam o CRUD.
5. A pré-visualização usa pdfjs (PDF), `<img>` (imagem) e texto escapado (demais); nunca HTML do documento.

## Estados reais (R4)

`GET /api/health` informa se o armazenamento e o Turnstile estão configurados e o valor das feature flags. A interface desabilita o envio e mostra o motivo quando o armazenamento não está configurado. Em produção, sem segredo do Turnstile, cadastro/login/upload respondem `SERVICE_NOT_CONFIGURED`.

## Monetização

`feature_flags.monetization_enabled = false`; `/api/billing/*` responde 404; nenhum SDK de pagamento.
