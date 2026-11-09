# Limitações atuais (Fase 1)

- **Extração de texto, busca, comparação, formulários e geração** ainda não existem (Fases 2 a 6). Documentos enviados ficam com status `needs_text`.
- **Armazenamento**: exige que você ative o R2 (ou o plano B) na sua conta; sem isso o envio fica desabilitado.
- **OCR e IA**: não rodam no servidor (ver `docs/free-tier-limits.md` e `docs/decisions.md`).
- **Push notifications**: não implementado; apenas notificações in-app (tabela `notifications`).
- **Quotas do plano gratuito**: 1 GB por workspace, 25 MB por arquivo, 200 documentos (valores em `docs/decisions.md`).
- **Testes E2E de interface (Playwright) e Lighthouse CI**: não executados nesta fase.
