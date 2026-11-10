# Limitações atuais (Fase 2)

- **Comparação, formulários e geração** ainda não existem (Fases 3 a 6).
- **Nada foi validado em Cloudflare real** (D1, R2, Workers, CPU de 10 ms, custo de escritas do FTS5). Os testes rodam em libSQL local com armazenamento em memória.
- **Texto**: DOCX mostra só texto (sem layout, tabelas ou imagens). PDFs com mais de 300 páginas, ou com uma página de mais de 30.000 caracteres, não são extraídos. Não há detecção de idioma (`language` fica vazio).
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
