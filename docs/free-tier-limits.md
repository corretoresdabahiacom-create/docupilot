# Limites do free tier Cloudflare — DocuPilot AI

Verificado em **2026-11-09** nas páginas oficiais (links ao final). Reverifique antes de cada fase: os limites mudam.
Itens marcados **[não verificado]** não foram confirmados em fonte oficial e não devem ser assumidos.

## 1. Workers (plano Free)

| Limite                             | Valor                                                   |
| ---------------------------------- | ------------------------------------------------------- |
| Requisições                        | 100.000 por dia (reset 00:00 UTC); excedido → erro 1027 |
| **CPU por requisição HTTP**        | **10 ms**                                               |
| **CPU por Cron Trigger**           | **10 ms**                                               |
| Memória                            | 128 MB por isolate                                      |
| Corpo de requisição (domínio Free) | 100 MB                                                  |
| Subrequests por invocação          | 50                                                      |
| Conexões de saída simultâneas      | 6                                                       |
| Tamanho do Worker                  | 64 MiB (sem compressão)                                 |
| Workers por conta                  | 100                                                     |
| Cron Triggers por conta            | 5                                                       |
| Variáveis de ambiente              | 64 por Worker, 5 KB cada                                |

## 2. D1 (plano Free)

| Limite                              | Valor                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| Linhas lidas                        | 5 milhões/dia                                                                   |
| Linhas escritas                     | 100.000/dia                                                                     |
| Armazenamento total na conta        | 5 GB                                                                            |
| Bancos por conta                    | 10                                                                              |
| Tamanho máximo por banco            | 500 MB                                                                          |
| Queries por invocação de Worker     | 50                                                                              |
| Tamanho máximo de linha/string/BLOB | 2 MB                                                                            |
| Parâmetros por query                | 100                                                                             |
| Ao exceder                          | queries falham até 00:00 UTC; com 5 GB cheios não insere nem cria tabela/índice |
| FTS5                                | **[não verificado]**                                                            |

## 3. R2

| Limite                     | Valor                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------- |
| Armazenamento              | 10 GB-mês (Standard)                                                                           |
| Class A (escrita/listagem) | 1 milhão/mês                                                                                   |
| Class B (leitura)          | 10 milhões/mês                                                                                 |
| Egress                     | gratuito                                                                                       |
| Teto rígido (hard cap)     | **Não existe na documentação**: o excedente é cobrado automaticamente                          |
| Ativação                   | exige checkout de assinatura R2; se o checkout pede cartão **[não verificado em doc oficial]** |

Presigned URLs: suportam GET/HEAD/PUT/DELETE; validade máxima de 7 dias; exigem credenciais S3 do R2 (Access Key/Secret) e `aws4fetch` ou AWS SDK (o binding do Worker não gera); não funcionam com domínio customizado; exigem CORS configurado para PUT no navegador; POST de formulário não é suportado.

## 4. KV (plano Free)

| Limite                           | Valor         |
| -------------------------------- | ------------- |
| Leituras                         | 100.000/dia   |
| **Escritas (chaves diferentes)** | **1.000/dia** |
| Escritas na mesma chave          | 1/segundo     |
| Armazenamento                    | 1 GB          |
| Valor máximo                     | 25 MiB        |

## 5. Queues (plano Free, disponível desde 2026-02-04)

10.000 operações/dia por conta (leitura, escrita e exclusão contam), retenção máxima de mensagem de 24 h, consumidores por Worker ou HTTP pull.

## 6. Turnstile

**[não verificado]**: confirmar limites e requisitos do plano gratuito antes da Fase 1.

## 7. Implicações para o briefing (decisões pendentes)

1. **CPU de 10 ms** (e não ~30 s): extração server-side com `unpdf`, PBKDF2 e diff/SimHash provavelmente estouram. Exige prova de conceito; alternativa é extrair no cliente (`pdfjs-dist`) e enviar só o texto ao servidor.
2. **Rate limit em KV inviável**: 1.000 escritas/dia acaba em minutos. Usar outra solução (D1 com contadores, ou outra opção a verificar).
3. **R2 sem teto rígido**: conflita com R1 (custo zero, sem cartão). Os caps de uso precisam ser aplicados pela própria aplicação.
4. **Quotas desalinhadas**: 5 GB/workspace sobre 10 GB de R2 e 5 GB de D1 por conta; quotas precisam ter teto global também. D1: 500 MB por banco e 100.000 escritas/dia limitam `extracted_fields`, `audit_logs` e `sync_state`.
5. **50 subrequests / 50 queries por invocação**: gravar muitos campos extraídos exige lotes.
6. **Cron**: 5 triggers e 10 ms de CPU; retenção e limpeza devem ser feitas em lotes pequenos.

## 8. Orçamento de escritas da análise (Fase 3)

Uma análise grava, em um único lote: remoção do resultado anterior + 1 linha por campo agrupado + até 5 fontes por campo + achados + metadados (~`2 × campos` escritas). Com no máximo 400 ocorrências e 300 análises/mês, o pior caso é da ordem de dezenas de milhares de linhas por mês, dentro dos 100.000/dia, mas índices contam como escritas adicionais. **Estimativa; não medida em D1 real.**

## Fontes

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- https://developers.cloudflare.com/kv/platform/limits/
- https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/
