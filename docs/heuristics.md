# Catálogo de heurísticas e regex (`docs/heuristics.md`)

**Regra:** toda extração feita pelo DocuPilot passa por um `pattern_id` listado aqui. Se um padrão
não está neste documento, ele não existe no código. Se está aqui e implementado, tem teste unitário
(`packages/shared/src/extraction/patterns/<pattern_id>.test.ts`) e precisão esperada declarada.
O teste `packages/shared/src/extraction/coverage.test.ts` trava a consistência nos dois sentidos.

> **"Precisão esperada" é uma estimativa de projeto.** Nenhum padrão foi medido contra um corpus
> real de documentos nesta fase. Os testes provam o comportamento descrito (aceita/rejeita os casos
> listados), não a taxa de acerto em documentos reais.

Onde o código: `packages/shared/src/extraction/` (mesmo código no navegador, que extrai, e no Worker,
que **reconfere cada campo** contra o texto armazenado antes de gravar — ver `docs/decisions.md` D12).

## 0. Convenções

### 0.1 `source_kind`

| Valor           | Significado                                   | Como o usuário vê           |
| --------------- | --------------------------------------------- | --------------------------- |
| `deterministic` | Regex ou regra exata, resultado binário       | "Extraído"                  |
| `heuristic`     | Heurística com margem de erro declarada       | "Sugerido — verifique"      |
| `ocr`           | Vem de OCR (tesseract.js)                     | "Via OCR — verifique"       |
| `ai_external`   | Provedor de IA externo (desligado por padrão) | "Gerado por IA — verifique" |

### 0.2 `confidence`

Escala ordenada 0.0–1.0, **não é probabilidade**: 1.0 exato (regex estrito com validação), 0.9 alto,
0.8 por extenso/heurística forte, 0.7 médio, 0.5 heurística, 0.3 baixo (SimHash). Abaixo de 0.3 o
campo é descartado. A confiança nunca é inventada: vem do `pattern_id` (o servidor a regenera ao
reconferir; o valor enviado pelo navegador é ignorado).

### 0.3 Campos gravados

`extracted_fields`: tipo, valor cru, valor normalizado, `pattern_id`, `confidence`, `source_kind`,
rótulo (datas e valores). `extraction_sources`: página, intervalo no texto (`text_span_start/end`),
trecho (`snippet`), `pattern_id`, `confidence`. Ocorrências repetidas do mesmo valor viram **um**
campo com até 5 fontes. Valores monetários normalizam para `"1234.56 BRL"`.

### 0.4 Limites do navegador e do servidor

Até 400 ocorrências por análise e 100 candidatos de inconsistência; o que passar disso é cortado e o
usuário é avisado ("N ocorrências não foram guardadas").

## 1. Documentos de identificação (Brasil)

### 1.1 cpf_strict

| Campo             | Valor                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pattern_id`      | `cpf_strict`                                                                                                      |
| field_type        | `cpf`                                                                                                             |
| Regex             | `(?<![\d.\-/])(\d{3})\.?(\d{3})\.?(\d{3})-?(\d{2})(?!\d\|[.\-/]\d)`                                               |
| Normalização      | só dígitos                                                                                                        |
| Validação         | dígito verificador (módulo 11); todos os dígitos iguais é descartado                                              |
| confidence        | 1.0 (DV válido). DV inválido: descartado como campo                                                               |
| source_kind       | deterministic                                                                                                     |
| Precisão esperada | 99 % (falso positivo só se outro número de 11 dígitos casar o DV; ~1 % dos celulares de 11 dígitos sem pontuação) |

### 1.2 cnpj_strict

| Campo             | Valor                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `pattern_id`      | `cnpj_strict`                                                                              |
| field_type        | `cnpj`                                                                                     |
| Regex             | `(\d{2})\.?(\d{3})\.?(\d{3})/?(\d{4})-?(\d{2})` com bordas como no CPF                     |
| Validação         | DV módulo 11 (dois dígitos); todos iguais descartado                                       |
| confidence        | 1.0; DV inválido descartado                                                                |
| source_kind       | deterministic                                                                              |
| Precisão esperada | 99 %                                                                                       |
| Limitação         | só CNPJ **numérico**. O CNPJ alfanumérico (vigente a partir de jul/2026) não é reconhecido |

### 1.3 rg_flexible

| Campo        | Valor                                                                                   |
| ------------ | --------------------------------------------------------------------------------------- |
| `pattern_id` | `rg_flexible`                                                                           |
| Estado       | **planejado, não implementado** (formatos variam por estado; confidence 0.7, heuristic) |

### 1.4 cnh_number

| Campo        | Valor                           |
| ------------ | ------------------------------- |
| `pattern_id` | `cnh_number`                    |
| Estado       | **planejado, não implementado** |

### 1.5 passport_br

| Campo        | Valor                           |
| ------------ | ------------------------------- |
| `pattern_id` | `passport_br`                   |
| Estado       | **planejado, não implementado** |

## 2. Contato e endereço

### 2.1 email_strict

| Campo             | Valor                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pattern_id`      | `email_strict`                                                                                                          |
| field_type        | `email`                                                                                                                 |
| Regex             | `[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}`; rejeita `..` e ponto no início/fim da parte local |
| Normalização      | minúsculas                                                                                                              |
| confidence        | 0.9 (PDFs podem quebrar e-mails em duas linhas)                                                                         |
| source_kind       | deterministic                                                                                                           |
| Precisão esperada | 95 %                                                                                                                    |

### 2.2 phone_br_mobile

| Campo             | Valor                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `pattern_id`      | `phone_br_mobile`                                                                                     |
| field_type        | `phone`                                                                                               |
| Regex             | `(\+55)? (DDD)? 9\d{4}[ -]?\d{4}`, sem dígito/`.`/`,`/`/`/`-`/`+`/`$` colado antes, sem dígito depois |
| Normalização      | `+55 DD NNNNN-NNNN` (sem DDD: `NNNNN-NNNN`)                                                           |
| Validação         | DDD na lista embutida de DDDs; rejeita dígitos todos iguais                                           |
| confidence        | 0.9 com DDD; 0.7 sem DDD (aceito só no formato com hífen `9XXXX-XXXX`)                                |
| source_kind       | deterministic                                                                                         |
| Precisão esperada | 85 %                                                                                                  |

### 2.3 phone_br_landline

| Campo             | Valor                                                                |
| ----------------- | -------------------------------------------------------------------- |
| `pattern_id`      | `phone_br_landline`                                                  |
| field_type        | `phone_landline`                                                     |
| Regex             | como o celular, mas `[2-5]\d{3}[ -]?\d{4}`                           |
| Validação         | DDD válido; sem DDD só `NNNN-NNNN` e nunca par de anos (`2023-2024`) |
| confidence        | 0.9 com DDD; 0.7 sem DDD                                             |
| source_kind       | deterministic                                                        |
| Precisão esperada | 80 %                                                                 |

### 2.4 cep_strict

| Campo             | Valor                                                                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id`      | `cep_strict`                                                                                                                                 |
| field_type        | `cep`                                                                                                                                        |
| Regex             | `\d{5}-?\d{3}`                                                                                                                               |
| Validação         | faixa 01000-000 a 99999-999                                                                                                                  |
| confidence        | 1.0 com a palavra "CEP" logo antes (deterministic); 0.5 isolado **e só com hífen** (heuristic). Oito dígitos soltos sem "CEP" são rejeitados |
| Precisão esperada | 98 % explícito; 70 % isolado                                                                                                                 |

### 2.5 address_br_heuristic

| Campo             | Valor                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id`      | `address_br_heuristic`                                                                                                                                                                             |
| field_type        | `address`                                                                                                                                                                                          |
| Algoritmo         | tipo de logradouro (Rua, Av., Travessa, Alameda, Praça, Rodovia, Estrada — com inicial maiúscula ou em caixa alta) + nome + vírgula + número (ou s/n), até dois complementos curtos e CEP opcional |
| confidence        | 0.5                                                                                                                                                                                                |
| source_kind       | heuristic                                                                                                                                                                                          |
| Precisão esperada | ~60 % em textos bem formatados; falha em layout colunar e em logradouros escritos em minúsculas                                                                                                    |
| Aviso na UI       | "Endereço detectado por heurística — confirme"                                                                                                                                                     |

### 2.6 address_br_structured

| Campo             | Valor                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id`      | `address_br_structured`                                                                                                                                          |
| field_type        | `address`                                                                                                                                                        |
| Algoritmo         | linhas rotuladas consecutivas (`Logradouro:`/`Endereço:`, `Bairro:`, `Cidade:`/`Município:`, `Estado:`/`UF:`, `CEP:`); exige Logradouro e ao menos Cidade ou CEP |
| confidence        | 0.9                                                                                                                                                              |
| source_kind       | deterministic                                                                                                                                                    |
| Precisão esperada | 90 %                                                                                                                                                             |

## 3. Datas

### 3.1 date_br_numeric

| Campo             | Valor                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `pattern_id`      | `date_br_numeric`                                                                                                        |
| field_type        | `date`                                                                                                                   |
| Regex             | `(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}\|\d{2})`, mesmo separador nos dois pontos                                          |
| Validação         | calendário real (rejeita 30/02), ano 1900–2100; ano de 2 dígitos: < 50 → 20XX, senão 19XX                                |
| Normalização      | ISO `YYYY-MM-DD`                                                                                                         |
| confidence        | 0.9; 0.7 quando é ambígua (dia e mês ≤ 12 e diferentes) **e** o idioma é `und`                                           |
| source_kind       | deterministic                                                                                                            |
| Precisão esperada | 90 %                                                                                                                     |
| Ambiguidade       | em documento detectado como `en`, datas ambíguas com `/` ficam com `date_us_numeric`; só as com dia > 12 permanecem aqui |

### 3.2 date_br_extenso

| Campo             | Valor                                                                      |
| ----------------- | -------------------------------------------------------------------------- |
| `pattern_id`      | `date_br_extenso`                                                          |
| field_type        | `date`                                                                     |
| Regex             | `(\d{1,2})º? de (janeiro…dezembro) de (\d{4})`, sem diferenciar maiúsculas |
| confidence        | 1.0                                                                        |
| source_kind       | deterministic                                                              |
| Precisão esperada | 98 %                                                                       |

### 3.3 date_us_numeric

| Campo             | Valor                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| `pattern_id`      | `date_us_numeric`                                                                                               |
| field_type        | `date`                                                                                                          |
| Regra             | `MM/DD/AAAA` com `/`, **só** em documento detectado como `en`, e só quando ambígua (mês e dia ≤ 12, diferentes) |
| confidence        | 0.9                                                                                                             |
| source_kind       | deterministic                                                                                                   |
| Precisão esperada | 85 % (depende da detecção de idioma)                                                                            |

### 3.4 date_iso

| Campo             | Valor                                   |
| ----------------- | --------------------------------------- |
| `pattern_id`      | `date_iso`                              |
| field_type        | `date`                                  |
| Regex             | `\d{4}-\d{2}-\d{2}` com calendário real |
| confidence        | 1.0                                     |
| source_kind       | deterministic                           |
| Precisão esperada | 99 %                                    |

## 4. Valores monetários

Normalização: `"<valor com ponto decimal> <moeda>"`, p.ex. `1234.56 BRL`. Separador decimal = último
`.` ou `,` seguido de 1–2 dígitos; seguido de 3 dígitos é separador de milhar.

### 4.1 currency_brl

| Campo             | Valor                                     |
| ----------------- | ----------------------------------------- |
| `pattern_id`      | `currency_brl`                            |
| field_type        | `money`                                   |
| Regex             | `R\$\s?(\d{1,3}(\.\d{3})+\|\d+)(,\d{2})?` |
| confidence        | 1.0                                       |
| source_kind       | deterministic                             |
| Precisão esperada | 98 %                                      |

### 4.2 currency_usd

| Campo             | Valor                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `pattern_id`      | `currency_usd`                                                                                             |
| field_type        | `money`                                                                                                    |
| Regex             | `US$`, `USD` ou `$` + valor no formato `1,234.56`; o `$` sozinho só vale com "USD"/"dólar" a 40 caracteres |
| confidence        | 1.0 (`US$`/`USD`); 0.9 (`$` com contexto)                                                                  |
| source_kind       | deterministic                                                                                              |
| Precisão esperada | 95 %                                                                                                       |

### 4.3 currency_eur

| Campo             | Valor                                                   |
| ----------------- | ------------------------------------------------------- |
| `pattern_id`      | `currency_eur`                                          |
| field_type        | `money`                                                 |
| Regex             | `€ N`, `EUR N` ou `N €`; aceita `1.234,56` e `1,234.56` |
| confidence        | 1.0                                                     |
| source_kind       | deterministic                                           |
| Precisão esperada | 95 %                                                    |

### 4.4 currency_written_br

| Campo             | Valor                                                                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id`      | `currency_written_br`                                                                                                                                                                                                 |
| field_type        | `money`                                                                                                                                                                                                               |
| Algoritmo         | regex sobre sequência de numerais seguida de "reais/real" (+ "e … centavos") e parser próprio de numeral por extenso até 999 bilhões; gramática estrita (rejeita "mil mil", "cem e dois", "milhão" sem multiplicador) |
| confidence        | 0.8                                                                                                                                                                                                                   |
| source_kind       | heuristic                                                                                                                                                                                                             |
| Precisão esperada | ~90 % em valores comuns; falha em construções arcaicas e em numerais com erro de grafia                                                                                                                               |

### 4.5 money_percentage

| Campo             | Valor                    |
| ----------------- | ------------------------ |
| `pattern_id`      | `money_percentage`       |
| field_type        | `percentage`             |
| Regex             | `\d{1,3}(,\d{1,2})?\s?%` |
| confidence        | 0.9                      |
| source_kind       | deterministic            |
| Precisão esperada | 95 %                     |

## 5. Números de referência

### 5.1 invoice_number

| Campo             | Valor                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id`      | `invoice_number`                                                                                                           |
| field_type        | `invoice_number`                                                                                                           |
| Regex             | `NF`/`NF-e`/`Nota Fiscal [Eletrônica\|de Serviços]` + opcional `nº`/`número`/`#`/`:` + 3–15 dígitos (ou milhar com pontos) |
| Normalização      | só dígitos                                                                                                                 |
| confidence        | 0.8                                                                                                                        |
| source_kind       | heuristic                                                                                                                  |
| Precisão esperada | 75 %                                                                                                                       |

### 5.2 process_number_br

| Campo             | Valor                                                        |
| ----------------- | ------------------------------------------------------------ |
| `pattern_id`      | `process_number_br`                                          |
| field_type        | `process_number`                                             |
| Regex             | `\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}` (numeração única CNJ) |
| Validação         | DV = 98 − ((NNNNNNN AAAA JTR OOOO 00) mod 97)                |
| confidence        | 1.0                                                          |
| source_kind       | deterministic                                                |
| Precisão esperada | 99 %                                                         |

### 5.3 po_number

| Campo             | Valor                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id`      | `po_number`                                                                                                                                               |
| field_type        | `po_number`                                                                                                                                               |
| Regex             | `Purchase Order`/`Ordem de Compra`/`Pedido [de Compra]`/`PO`/`OC` + opcional `nº`/`#`/`:` + `[A-Za-z0-9][A-Za-z0-9\-/]{3,19}` contendo ao menos um dígito |
| confidence        | 0.7                                                                                                                                                       |
| source_kind       | heuristic                                                                                                                                                 |
| Precisão esperada | 65 %                                                                                                                                                      |

## 6. Elementos contratuais

`clause_boundary` foi entregue na Fase 4 (abaixo). `contract_party`, `deadline_expression` e
`obligation_marker` **não estão implementados** (não fazem parte da Fase 4 do briefing). Nenhum deles é
análise jurídica; "quais são as obrigações?" exige IA externa e fica indisponível por padrão.

| Campo        | Valor            |
| ------------ | ---------------- |
| `pattern_id` | `contract_party` |

| Campo             | Valor                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pattern_id`      | `clause_boundary`                                                                                                                                                              |
| Estado            | implementado na Fase 4 (`patterns/clause_boundary.ts`); **best effort, heurística**                                                                                            |
| Algoritmo         | uma cláusula começa em linha que inicia com `1.`, `1.1.`/`1.1`, `Art. 5º`/`Artigo 5`, `Cláusula 3ª` ou `Cláusula Primeira` (ordinais por extenso); vai até o próximo cabeçalho |
| Limites           | até 2 dígitos por nível (`1.000` e `10.05.2024` não contam); um nível exige ponto (`1.`); chave repetida vira `1#2`                                                            |
| source_kind       | heuristic                                                                                                                                                                      |
| Precisão esperada | não medida. Falha quando o PDF não preserva quebras de linha, ou quando uma linha de texto comum começa com número (`2.5 mil`)                                                 |
| Resultado         | "cláusula" = trecho de texto sob um cabeçalho numerado; **não** é juízo sobre validade jurídica                                                                                |

| Campo        | Valor                 |
| ------------ | --------------------- |
| `pattern_id` | `deadline_expression` |

| Campo        | Valor               |
| ------------ | ------------------- |
| `pattern_id` | `obligation_marker` |

## 7. Duplicidade e similaridade

### 7.1 dedup_exact

| Campo        | Valor                                                                      |
| ------------ | -------------------------------------------------------------------------- |
| `pattern_id` | `dedup_exact`                                                              |
| Algoritmo    | igualdade do SHA-256 da versão atual de dois documentos do mesmo workspace |
| confidence   | 1.0                                                                        |
| source_kind  | deterministic                                                              |
| Resultado    | "Duplicado exato"                                                          |

### 7.2 dedup_simhash

| Campo             | Valor                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id`      | `dedup_simhash`                                                                                                                                                         |
| Algoritmo         | SimHash de 64 bits (FNV-1a de 64 bits com mistura final) sobre shingles de 3 palavras (minúsculas, sem acento, só `[a-z0-9]`); mínimo de 30 palavras, senão não há hash |
| **Limiar**        | **distância de Hamming ≤ 6 → "possivelmente similar"; > 6 → distinto**                                                                                                  |
| confidence        | 0.5 (sempre)                                                                                                                                                            |
| source_kind       | heuristic                                                                                                                                                               |
| Aviso na UI       | "Possivelmente similar — não é cópia exata"                                                                                                                             |
| Precisão esperada | não estimada: com 64 bits e limiar 6, textos sem relação raramente ficam ≤ 6, mas edições grandes ou reordenação de parágrafos podem passar despercebidas               |
| Origem do hash    | calculado **no navegador** e informado ao servidor, que só valida o formato (16 hex). Serve apenas para sugerir similaridade dentro do próprio workspace                |

### 7.3 dedup_failed

| Campo        | Valor                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------- |
| `pattern_id` | `dedup_failed`                                                                                |
| Regra        | documento sem texto extraído (ou sem SimHash) não participa da similaridade; só `dedup_exact` |

## 8. Texto lixo

### 8.1 text_garbage_detector

| Campo        | Valor                                                                                                                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id` | `text_garbage_detector`                                                                                                                                                                                                                                        |
| Algoritmo    | mede composição do texto: vazio/curto demais, proporção de U+FFFD (> 5 %), de área de uso privado (> 20 %) e de letras/dígitos (< 50 %). **Difere do rascunho do briefing** (limiar 0.15 de não imprimíveis): os limiares acima são os implementados na Fase 2 |
| confidence   | n/a (booleano)                                                                                                                                                                                                                                                 |
| source_kind  | deterministic                                                                                                                                                                                                                                                  |
| Ação         | PDF com texto ilegível vira `extraction_failed`; PDF sem texto vira `needs_ocr`                                                                                                                                                                                |

## 9. Tabelas (PDF)

### 9.1 table_heuristic

| Campo        | Valor                                                      |
| ------------ | ---------------------------------------------------------- |
| `pattern_id` | `table_heuristic`                                          |
| Estado       | **planejado, não implementado** (exige itens posicionados) |

## 10. Formulários AcroForm

### 10.1 acroform_field

| Campo        | Valor                                                                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id` | `acroform_field`                                                                                                                                                              |
| Estado       | **planejado (Fase 5)**. Na Fase 3, a regra `empty_required_acroform` lê os widgets via pdf.js no navegador (nome, obrigatório, preenchido), sem gravá-los como campo extraído |

### 10.2 acroform_type_mapping

| Campo        | Valor                   |
| ------------ | ----------------------- |
| `pattern_id` | `acroform_type_mapping` |
| Estado       | **planejado (Fase 5)**  |

## 11. Idioma

### 11.1 language_detect

| Campo             | Valor                                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id`      | `language_detect`                                                                                                                                                                                                                   |
| Algoritmo         | **contagem de palavras funcionais** (pt/en/es) nos primeiros 5.000 caracteres, ignorando palavras comuns a mais de um idioma. **Não usa `franc`** (desvio do briefing: evita uma dependência e cobre só os três idiomas do produto) |
| Resultado         | `pt` \| `en` \| `es` \| `und` (indefinido se < 5 palavras exclusivas ou sem margem de 1,5×)                                                                                                                                         |
| confidence        | fração das palavras exclusivas que apontam para o idioma escolhido (não é a do `franc`)                                                                                                                                             |
| source_kind       | deterministic                                                                                                                                                                                                                       |
| Ação              | decide entre datas BR e US (§3). `und` usa BR e rebaixa datas ambíguas a 0.7                                                                                                                                                        |
| Precisão esperada | 90 % em textos de ≥ 100 palavras; baixa em textos curtos e em documentos mistos                                                                                                                                                     |

## 12. OCR

### 12.1 ocr_tesseract

| Campo        | Valor                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `pattern_id` | `ocr_tesseract`                                                                                                          |
| Estado       | implementado na Fase 2 em `apps/web/src/lib/extract/ocr.ts` (navegador); texto de OCR carrega `extractedBy = client_ocr` |
| source_kind  | ocr                                                                                                                      |
| Caps         | 10 páginas/execução, imagem ≤ 5 MB, bloqueio mobile por padrão, consentimento prévio                                     |

## 13. Comparação (Fase 4)

Tudo roda no navegador sobre o texto já armazenado e **compara o que está escrito**; não diz se uma mudança é relevante, válida ou legal. Resultados não são gravados.

### 13.1 diff_textual

| Campo        | Valor                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id` | `diff_textual`                                                                                                                                                                                                |
| Algoritmo    | texto vira linhas (linhas > 300 caracteres viram frases); `diffArrays` (biblioteca `diff`, Myers) compara as linhas ignorando só espaços; blocos substituídos são alinhados e cada par ganha diff de palavras |
| Alinhamento  | bloco de mesmo tamanho: pares por posição; tamanhos diferentes: alinhamento monótono por similaridade de palavras (Jaccard ≥ 0,3), pulado acima de 250.000 pares                                              |
| Limites      | 3.000 linhas por lado (o excedente é cortado e avisado)                                                                                                                                                       |
| source_kind  | deterministic (o diff) · o pareamento de linhas alteradas é heurístico                                                                                                                                        |
| Similaridade | linhas iguais ÷ maior número de linhas; é uma proporção de linhas, não de significado                                                                                                                         |

### 13.2 diff_fields

| Campo        | Valor                                                                                                                                                                                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id` | `diff_fields`                                                                                                                                                                                       |
| Algoritmo    | roda os padrões da Fase 3 nos dois textos; agrupa por (tipo, rótulo); valores nos dois lados = `igual`; um valor só em A e um só em B **com rótulo** = `alterado`; demais = `somente_a`/`somente_b` |
| Origem       | até 3 ocorrências por lado, com página e trecho                                                                                                                                                     |
| Limites      | 400 ocorrências por lado                                                                                                                                                                            |
| Limitação    | sem rótulo não se afirma "alterado". Rótulo diferente entre versões aparece como removido + adicionado                                                                                              |
| Confiança    | herdada de cada padrão; os campos **não** são reconferidos pelo servidor (calculados do texto armazenado)                                                                                           |

### 13.3 diff_clause

| Campo        | Valor                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id` | `diff_clause`                                                                                                                                                              |
| Algoritmo    | pareia cláusulas pela chave de `clause_boundary`; texto igual = `igual`, diferente = `alterada` (diff de palavras até 20.000 caracteres); sem par: `removida`/`adicionada` |
| Renumeração  | cláusulas sem par com corpo de similaridade de palavras (Jaccard) ≥ 0,8 viram `renumerada_possivel`, marcada **exige revisão humana**                                      |
| Limitação    | depende da heurística de `clause_boundary`; cláusula movida e renumerada com texto reescrito aparece como removida + adicionada                                            |

### 13.4 Exportação

CSV (BOM UTF-8, CRLF, células iniciadas por `= + - @` recebem apóstrofo contra injeção de fórmula), JSON completo (sem as partes iguais do texto) e Markdown (caracteres de marcação escapados). Todos levam o aviso de que é comparação textual heurística, sem parecer jurídico.

## 14. Resumo extrativo

### 14.1 summary_textrank

| Campo                | Valor                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pattern_id`         | `summary_textrank`                                                                                                                                                                      |
| Algoritmo            | TextRank: sentenças (mín. 30 e máx. 500 caracteres; até 500 por documento) → vetores TF-IDF → similaridade de cosseno → PageRank (d = 0,85; 30 iterações)                               |
| Modos                | **executivo** (top 5, na ordem do documento), **tópicos** (top 10 agrupados por sobreposição de termos ≥ 0,2), **cronológico** (frases com data detectada, até 10, ordenadas pela data) |
| confidence           | n/a (frases são do documento)                                                                                                                                                           |
| source_kind          | heuristic                                                                                                                                                                               |
| Aviso na UI          | "Resumo extrativo — frases originais selecionadas"                                                                                                                                      |
| Indisponíveis sem IA | "por cláusulas" e "por obrigações" (`requires_ai`)                                                                                                                                      |

### 14.2 keywords_yake

| Campo        | Valor                           |
| ------------ | ------------------------------- |
| `pattern_id` | `keywords_yake`                 |
| Estado       | **planejado, não implementado** |

## 15. Inconsistências por regra

Cada achado carrega categoria, página e trecho. Nada aqui é julgamento jurídico: a categoria
descreve **a regra aplicada**, não uma conclusão sobre o documento.

| rule_id                     | Regra                                                                                      | Categoria                   |
| --------------------------- | ------------------------------------------------------------------------------------------ | --------------------------- |
| `date_conflict_same_label`  | 2+ datas **distintas** para o mesmo rótulo de valor único no documento                     | `erro_confirmado_por_regra` |
| `money_conflict_same_label` | 2+ valores distintos (valor ou moeda) para o mesmo rótulo de valor único                   | `erro_confirmado_por_regra` |
| `empty_required_acroform`   | campo AcroForm obrigatório vazio (lido pelo navegador; o servidor não reconfere o PDF)     | `erro_confirmado_por_regra` |
| `missing_annex_reference`   | o texto menciona "Anexo I/II/…" e nenhum documento do workspace tem esse anexo no nome     | `exige_revisao_humana`      |
| `duplicate_exact`           | SHA-256 idêntico ao de outro documento                                                     | `erro_confirmado_por_regra` |
| `duplicate_similar`         | SimHash com distância de Hamming ≤ 6                                                       | `divergencia_identificada`  |
| `cpf_cnpj_dv_invalid`       | número casa o formato mas o DV falha, **e** a palavra CPF/CNPJ vem até 20 caracteres antes | `erro_confirmado_por_regra` |

Desvios deliberados do briefing, para reduzir falsos alarmes:

- **Rótulos de valor único.** `date_conflict_same_label` e `money_conflict_same_label` só consideram
  rótulos que, por natureza, aparecem uma vez (datas: vencimento, emissão, assinatura, nascimento,
  início, término, validade; valores: total, total geral, valor total, valor do contrato, valor global,
  valor da nota, valor líquido, valor bruto). "Valor:" ou "Data:" repetem legitimamente e ficam de fora.
- **`cpf_cnpj_dv_invalid` exige a palavra CPF/CNPJ por perto.** Qualquer número de 11 ou 14 dígitos com
  DV errado (telefone, protocolo) geraria ruído. Um CPF inválido sem a palavra "CPF" por perto não é
  apontado.
- **`missing_annex_reference`** compara com **nomes de arquivo** ("Anexo I - …", "anexo_02", "Anexo A").
  Um anexo enviado com outro nome será apontado como ausente (por isso a categoria é de revisão humana).

## 16. Processo de adição de novo `pattern_id`

1. Descrever o padrão, casos reais (anonimizados) e a precisão esperada.
2. Implementar em `packages/shared/src/extraction/patterns/<pattern_id>.ts`, exportando `PATTERN_ID`.
3. Teste `<pattern_id>.test.ts` com no mínimo 5 casos positivos e 5 negativos (e ambiguidades).
4. Entrada neste documento com os campos de §0.
5. Registrar em `docs/limitations.md` se aplicar.
6. Se o padrão extrai campos, registrá-lo em `FIELD_PATTERNS` (`analyze.ts`) — sem isso o servidor o rejeita.

## 17. Manutenção

Revisar a precisão real por `pattern_id` com dados anonimizados e consentimento. Padrão com precisão
real < 70 % da esperada: reduzir a confiança. < 50 %: desativar e manter apenas em `docs/limitations.md`.
Esta revisão **ainda não existe** (não há dados reais).

Versão: 0.2.0 (Fase 3)
