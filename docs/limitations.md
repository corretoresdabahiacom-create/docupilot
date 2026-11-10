# Limitações atuais (Fase 3)

- **Comparação, preenchimento de formulários e geração** ainda não existem (Fases 4 a 6).
- **Nada foi validado em Cloudflare real** (D1, R2, Workers, CPU de 10 ms, custo de escritas do FTS5). Os testes rodam em libSQL local com armazenamento em memória.
- **Texto**: DOCX mostra só texto (sem layout, tabelas ou imagens). PDFs com mais de 300 páginas, ou com uma página de mais de 30.000 caracteres, não são extraídos.
- **PDF com texto ilegível** vira `extraction_failed` e não oferece OCR (decisão do briefing); só `needs_ocr` abre o OCR.
- **OCR** é experimental: só desktop, 10 páginas por execução, imagens até 5 MB, qualidade variável, e depende do jsDelivr (ou de cópia própria). **Não foi executado** neste ambiente; só a lógica de proteção e envio foi testada.
- **Busca**: FTS5 ignora acentos; a alternativa em LIKE não. Só pesquisa a versão atual e documentos com texto extraído.
- **Versões**: metadados de extração são por documento, não por versão.
- **Objetos órfãos** podem sobrar se a limpeza no armazenamento falhar; não há faxina automática ainda.
- **Armazenamento**: exige que você ative o R2 (ou o plano B) e configure o CORS; sem isso o envio fica desabilitado.
- **Preview de PDF** exige CORS de GET e baixa o arquivo inteiro (até 25 MB) no navegador.
- **PWA**: os pacotes de PDF/DOCX/OCR entram no pré-cache do service worker, aumentando o primeiro carregamento.
- **Lighthouse** não foi executado. O teste de fumaça em Chromium (`apps/web/e2e/smoke.mjs`) usa a API em Node com armazenamento em memória, não o Worker.
- **Quotas**: 1 GB por workspace, 25 MB por arquivo, 200 documentos, 300 extrações/mês, 5.000.000 de caracteres de texto (`docs/decisions.md`).

## Fase 3 (extração estruturada e análise)

- **Precisão**: os números de precisão esperada em `docs/heuristics.md` são **estimativas**, nunca medidas em documentos reais. Padrões encontram só o que reconhecem; "nada encontrado" não prova ausência.
- **Padrões não entregues**: `rg_flexible`, `cnh_number`, `passport_br`, `table_heuristic`, `keywords_yake`. Cláusulas, partes, prazos, obrigações e diff ficam para as Fases 4 e 5.
- **CNPJ**: só o formato numérico; o CNPJ alfanumérico (a partir de jul/2026) não é reconhecido.
- **Endereços** vêm de heurística e são marcados "Sugerido — verifique".
- **Inconsistências**: só regras fixas e rótulos de valor único (lista fechada); a categoria descreve a regra aplicada, não é parecer jurídico, contábil ou fiscal. Lista vazia não garante que o documento esteja correto.
- **Campo obrigatório vazio (AcroForm)** e **SimHash** são calculados no navegador; o servidor não consegue refazê-los. O leitor de AcroForm com pdf.js **não foi testado com um PDF real**.
- **Resumo** é extrativo (frases originais); sem IA externa não há resumo por cláusulas ou obrigações, nem perguntas em linguagem natural.
- **Idioma**: detector próprio (pt/en/es), sem `franc`; textos curtos resultam em `und`.
- **Escrita em lote com `json_each`** não foi validada em D1 real.
- **Quotas**: inclui 300 análises/mês.
