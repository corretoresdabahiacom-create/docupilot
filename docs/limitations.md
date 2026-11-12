# Limitações atuais (Fase 5)

- **Geração de documentos e automação, empresas e administração** ainda não existem (Fases 6 a 8).
- **Nada foi validado em Cloudflare real** (D1, R2, Workers, CPU de 10 ms, custo de escritas do FTS5). Os testes rodam em libSQL local com armazenamento em memória.
- **Texto**: DOCX mostra só texto (sem layout, tabelas ou imagens). PDFs com mais de 300 páginas, ou com uma página de mais de 30.000 caracteres, não são extraídos.
- **PDF com texto ilegível** vira `extraction_failed` e não oferece OCR (decisão do briefing); só `needs_ocr` abre o OCR.
- **OCR** é experimental: só desktop, 10 páginas por execução, imagens até 5 MB, qualidade variável, e depende do jsDelivr (ou de cópia própria). **Não foi executado** neste ambiente; só a lógica de proteção e envio foi testada.
- **Busca**: FTS5 ignora acentos; a alternativa em LIKE não. Só pesquisa a versão atual e documentos com texto extraído.
- **Versões**: metadados de extração são por documento, não por versão.
- **Objetos órfãos** podem sobrar se a limpeza no armazenamento falhar; não há faxina automática ainda.
- **Armazenamento**: exige que você ative o R2 ou o plano B (Supabase Storage, implementado mas **não testado contra um projeto real**; ver `docs/env-vars.md`) e configure o CORS; sem isso o envio fica desabilitado. No plano gratuito do Supabase o espaço é 1 GB no total, somando todos os workspaces.
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

## Fase 4 (comparação)

- **Roda no navegador e não grava nada**: não há histórico de comparações; fechar a tela perde o resultado (só os arquivos exportados ficam). Documentos muito grandes (milhares de linhas) podem travar a aba por instantes; o limite é de 3.000 linhas por lado, com aviso.
- **Só dentro de um workspace**, e só com texto extraído nos dois lados (sem texto, a tela avisa qual lado falta).
- **Cláusulas** são heurística de melhor esforço (numeração no começo da linha). Erra em PDFs que perdem as quebras de linha, em listas numeradas que não são cláusulas e em cláusulas movidas e reescritas (aparecem como removida + adicionada). "Possível renumeração" exige confirmação humana.
- **Campos da comparação não são reconferidos pelo servidor** (não são gravados). "Alterado" só vale quando os dois valores têm o mesmo rótulo; sem rótulo aparecem como "só em A" e "só em B".
- **O diff compara texto, não significado**: reformular uma frase sem mudar o sentido aparece como alteração, e a similaridade é uma proporção de linhas iguais.
- **Nenhum juízo jurídico**: as situações (igual, alterada, removida…) descrevem mudança de texto, não validade ou efeito de cláusula.
- DOCX, TXT, MD e CSV são comparados por **seção** (~6.000 caracteres), não por página; as "páginas" citadas são seções.
- `contract_party`, `deadline_expression` e `obligation_marker` não foram implementados.
- O teste de fumaça em Chromium (24 verificações) roda contra a API em Node com armazenamento em memória, **não** contra o Worker real.

## Fase 5 (preenchimento de formulário e perfis)

- **Só AcroForm.** PDFs escaneados, XFA (dinâmicos) e criptografados não são preenchidos (a tela avisa); XFA pode mostrar campos que o leitor de PDF não mostra. Assinatura, botão e campo somente leitura nunca são preenchidos.
- **Ligação por nome do campo é heurística** e a precisão **não foi medida**. Nomes opacos ("Campo 17") ficam em branco; nomes parecidos pedem confirmação. A lista de "outra pessoa" é conservadora e pode bloquear campos legítimos (digite manualmente).
- **Dados de documentos de referência** vêm só do que a análise extraiu (CPF, CNPJ, e-mail, telefone, CEP, endereço; data só se rotulada como nascimento). Documento com vários CPFs gera ambiguidade que você resolve. Nome, RG, CNH e passaporte **não** são extraídos de documentos (só do perfil ou digitados).
- **Caixas de seleção** nunca são marcadas sozinhas; só por ação manual. Texto com caractere fora do WinAnsi (ex.: japonês, emoji) é recusado.
- **Testado** com PDFs gerados por `pdf-lib` (unidade e Chromium). **Não testado** com formulários reais de órgãos públicos, com fontes embutidas diferentes de Helvetica, nem com campos de formatação JavaScript.
- **Perfil**: até 10 por usuário; sem rotação de chave; perdeu `PII_ENCRYPTION_KEY`, perdeu os perfis. Nada ainda usa `extracted_fields.personal_profile_id`; só a limpeza na exclusão existe.
- Sem a chave configurada o recurso fica desligado (503); isso é o estado padrão até você criar o segredo.
- O teste de fumaça em Chromium (34 verificações) usa a API em Node com armazenamento em memória e uma chave de teste, **não** o Worker real.
