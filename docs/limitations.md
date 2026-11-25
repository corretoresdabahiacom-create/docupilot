# Limitações atuais (Fase 5)

- **Geração de documentos e automação, empresas e administração** ainda não existem (Fases 6 a 8).
- **Nada foi validado em Cloudflare real** (Supabase, R2, Workers, CPU de 10 ms, TLS do postgres.js no Worker). Os testes rodam em Postgres embutido (PGlite) com armazenamento em memória.
- **Texto**: DOCX mostra só texto (sem layout, tabelas ou imagens). PDFs com mais de 300 páginas, ou com uma página de mais de 30.000 caracteres, não são extraídos.
- **PDF com texto ilegível** vira `extraction_failed` e não oferece OCR (decisão do briefing); só `needs_ocr` abre o OCR.
- **OCR** é experimental: só desktop, 10 páginas por execução, imagens até 5 MB, qualidade variável, e depende do jsDelivr (ou de cópia própria). **Não foi executado** neste ambiente; só a lógica de proteção e envio foi testada.
- **Busca**: A busca textual (tsvector 'simple') ignora acentos só de Latin-1/Latin Extended-A e não faz stemming; a alternativa em LIKE não ignora acentos. Só pesquisa a versão atual e documentos com texto extraído.
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
- **Lotes atômicos** (`runBatch`) usam `db.transaction` + `toSQL()`; validado em PGlite, não no Supabase real.
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

## Fase 6 (criação e automação)

- **Modelos não têm validação jurídica, contábil ou fiscal.** São textos de partida; a interface avisa em cada tela. Não há modelos próprios (`document_templates` sem uso) nem biblioteca compartilhada.
- **PDF e DOCX têm layout simples** (títulos, parágrafos, listas, citações, código, tabelas básicas, imagens PNG/JPEG). Sem colunas, cabeçalho/rodapé, numeração de página, nem quebra de página manual. O PDF usa a fonte padrão Helvetica: caracteres fora do WinAnsi (japonês, emoji, alguns símbolos) viram `?` com aviso; GIF não entra no PDF; links no PDF são só coloridos e sublinhados (sem anotação clicável). Tabelas muito altas ou com células muito longas podem quebrar mal entre páginas. Para layout complexo, use HTML e imprima pelo navegador.
- **Exportação não é versionada**: o arquivo sai do conteúdo atual do editor (mesmo sem salvar) e a cota conta cada exportação. A cota padrão é **100/mês** (o briefing citava 200; D4).
- **Edição simultânea**: sem colaboração em tempo real. Salvamento com versão otimista; em conflito (409) a tela manda copiar o texto e recarregar.
- **Imagens** só embutidas (PNG/JPEG/GIF, até ~400 KB cada); documento grande demais (> ~900 mil caracteres de JSON) é recusado.
- **Workflows**: lineares, até 10 passos, sem edição na interface (para mudar, crie outro e exclua o antigo; a API tem `PUT`). `compare` no servidor é **só de campos extraídos** (resumo), não de texto ou cláusulas. Só lê análises já feitas: sem análise atualizada o passo falha, nunca inventa dados. O tempo de 5 min e os 30 s por passo valem para o **tempo ativo**; a espera por aprovação não tem prazo (execuções pendentes só saem por decisão ou cancelamento).
- **Retry** só cobre falha transitória (erro do banco, tempo do passo); como todos os passos são locais e rápidos, na prática raramente dispara. É coberto por testes do motor com executores simulados.
- **Aprovação em equipe**: vale a permissão `approve` do papel; o bloqueio de "quem iniciou" compara usuários, então um dono que inicia a execução não pode aprová-la, mas outro membro com a permissão pode.
- **Não testado no Cloudflare real**: os 10 ms de CPU e o handshake TLS do postgres.js nas rotas de workflow e de documentos criados; a validação de documentos grandes pode ser cara em CPU. Tiptap, `docx` e `pdf-lib` foram testados em jsdom e em Chromium contra a API em Node, **não** em navegadores diversos nem em celulares reais.
- O teste de fumaça em Chromium agora tem 45 verificações.

- **Migração para Supabase (D16)**: o projeto Supabase ainda **não existe** (será criado pelo usuário com outro e-mail) e as migrações `0000`/`0001` **nunca foram aplicadas** a um Postgres real do Supabase; só ao PGlite. Não há dados a migrar (o D1 nunca foi criado).

## Fase 7 (empresas)

- **Não validado no Supabase real**: a migração `0002` só rodou em PGlite; o projeto Supabase ainda não existe.
- **Convites sem e-mail**: o link é entregue por quem convida (copiar e enviar). Não há reenvio nem convite por e-mail.
- **Sem transferência de propriedade** nem exclusão de empresa/workspace; o proprietário não pode sair. Não há múltiplos proprietários.
- **Papel na organização** (`organization_members`) não concede acesso a workspaces; serve só para criar novos workspaces. Remover alguém de um workspace não o remove da organização.
- **Pastas restritas — o que NÃO foi coberto**: (1) a verificação de "anexo mencionado sem arquivo" na análise compara nomes de **todos** os documentos do workspace (só devolve sim/não, mas pode contar um anexo guardado em pasta oculta); (2) criar pasta com nome igual ao de uma pasta oculta irmã responde 409 e, assim, revela que o nome existe; (3) no fim do upload (`complete`) a pasta não é reverificada (foi checada ao iniciar); (4) documentos gerados (Fase 6) e workflows não pertencem a pastas, então não são restringidos; (5) uma execução de workflow já iniciada continua usando os documentos validados no início, mesmo que o acesso mude depois.
- **Cotas não são atômicas**: limite de membros, de convites pendentes e cota por membro são conferidos antes de gravar; duas requisições simultâneas podem ultrapassar o limite por pouco.
- **Cota por membro** conta bytes de versões enviadas; excluir o documento devolve o espaço, mas mudar de dono do documento não existe.
- **Histórico**: só registra ações que já geravam auditoria; downloads e leituras não são registrados.

## Fase 8 (administração e validação)

- **Não validado em produção**: o `scheduled()` (retenção), o `postgres.js` no Worker e as migrações `0002`/`0003` nunca rodaram em Worker/Supabase reais; só em Node + PGlite. O limite de 500 MB do Supabase e os limites do plano gratuito da Cloudflare **não foram verificados**.
- **Teste de carga é local**: `autocannon` contra Node + PGlite em memória (uma máquina, 10 conexões, 10 s): `/api/health` ≈ 1 900 req/s; listar documentos ≈ 290 req/s (p99 53 ms); busca ≈ 180 req/s (p99 84 ms). **Não representa** Workers + Supabase (latência de rede, pooler, CPU de 10 ms). Não há teste de carga de upload nem de extração.
- **Lighthouse** (v11, Chromium local, mobile simulado, tela de login servida por Node, sem CDN/HTTP/2): desempenho 70, acessibilidade 100, boas práticas 96, SEO 92, PWA 100. LCP 5,1 s sob throttling "slow 4G" simulado; o resto do bundle ainda é grande (`pdf.worker` 1,2 MB e o editor, carregados só nas telas que usam). Nota de desempenho em produção (com CDN e compressão) **não medida**. Só a tela de login foi auditada, não as internas.
- **Painel admin**: o primeiro admin é definido por SQL; não há reautenticação para ações sensíveis, nem 2FA, nem trilha de aprovação dupla. O consumo de Workers/R2/Supabase **não é medido** pelo app (confira nos painéis dos provedores). Links públicos de compartilhamento **não existem** (contadores zerados, sinalizado na tela).
- **Denúncias**: só documento pode ser removido; o dono não consegue contestar pelo app (apenas recebe aviso); o aviso é só no app (sem e-mail). A limitação de 5/hora usa o hash do IP e atrás de NAT compartilhado pode bloquear denunciantes legítimos.
- **Varredura de segurança automatizada** cobre rotas registradas no Hono; ela não substitui teste de intrusão, revisão de dependências nem verificação do WAF/Turnstile reais.
