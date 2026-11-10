# Variáveis de ambiente (API)

| Nome                                                                          | Tipo       | Obrigatória | Descrição                                                                   |
| ----------------------------------------------------------------------------- | ---------- | ----------- | --------------------------------------------------------------------------- |
| `DB`                                                                          | binding D1 | sim         | Banco principal                                                             |
| `STORAGE_BUCKET`                                                              | binding R2 | não         | Sem ele, o armazenamento fica "não configurado"                             |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | segredo    | com R2      | Credenciais S3 do R2 para gerar URLs assinadas                              |
| `TURNSTILE_SECRET`                                                            | segredo    | produção    | Verificação anti-robô                                                       |
| `ENVIRONMENT`                                                                 | var        | não         | `development` desliga o cookie `Secure` e o bloqueio por falta de Turnstile |
| `ALLOWED_ORIGINS`                                                             | var        | produção    | Origens do front autorizadas, separadas por vírgula                         |
| `PBKDF2_ITERATIONS`                                                           | var        | não         | Padrão e máximo: 100000                                                     |

Front (Vite): `VITE_API_URL` (opcional, padrão mesma origem) e `VITE_TURNSTILE_SITE_KEY` (opcional). OCR: `VITE_OCR_WORKER_PATH`, `VITE_OCR_CORE_PATH`, `VITE_OCR_LANG_PATH` (opcionais; sem elas o tesseract.js usa o jsDelivr).

## CORS do bucket R2

O navegador envia (PUT) e lê (GET, para preview, extração e OCR) direto no bucket. Configure no R2: origens = a URL do front; métodos `GET` e `PUT`; cabeçalhos permitidos `content-type` e `x-amz-checksum-sha256`. Sem GET, preview e extração a partir do arquivo guardado falham (o envio inicial continua funcionando).

Nenhum segredo vai para o repositório. Use `wrangler secret put <NOME>`.
