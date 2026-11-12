/**
 * Teste de fumaça no navegador (Chromium + Playwright), contra apps/api/e2e/server.ts.
 * Cobre: cadastro, pasta, envio, extração no navegador (pdfjs real), busca, preview,
 * duplicado, nova versão, PDF sem texto (needs_ocr + painel de OCR) e exclusão.
 * Playwright NÃO é dependência do repositório: usa a instalação do ambiente.
 *
 * Uso: pnpm --filter @docupilot/web build
 *      (cd apps/api && node ../../node_modules/.pnpm/tsx@*\/node_modules/tsx/dist/cli.mjs e2e/server.ts) &
 *      node apps/web/e2e/smoke.mjs
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:8799';
const OUT = process.env.OUT_DIR ?? '/tmp/claude-0/e2e-out';
mkdirSync(OUT, { recursive: true });

function makePdf(pages) {
  const objs = [];
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((text, i) => {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>`,
    );
    const stream = text ? `BT /F1 14 Tf 72 700 Td (${text}) Tj ET` : '';
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

const files = {
  contrato: join(OUT, 'contrato.pdf'),
  contratoV2: join(OUT, 'contrato-v2.pdf'),
  escaneado: join(OUT, 'escaneado.pdf'),
};
writeFileSync(
  files.contrato,
  makePdf([
    'Contrato de locacao residencial firmado entre as partes',
    'Clausula segunda: o valor do aluguel mensal e de mil reais',
  ]),
);
writeFileSync(
  files.contratoV2,
  makePdf(['Contrato de locacao revisado com novo prazo de vigencia']),
);
writeFileSync(files.escaneado, makePdf(['', '']));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({
  locale: 'pt-BR',
  serviceWorkers: 'block',
  viewport: { width: 1000, height: 900 },
});
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));

async function upload(file) {
  await page.setInputFiles('input[type=file]', file);
  await page.locator('form:has(input[type=file]) button[type=submit]').first().click();
}

try {
  // 1. cadastro
  await page.goto(`${BASE}/register`);
  await page.getByLabel('Nome').fill('Ana Teste');
  await page.getByLabel('E-mail').fill(`ana${Date.now()}@example.com`);
  await page.getByLabel('Senha').fill('correct horse battery staple');
  await page.getByRole('button', { name: 'Criar conta' }).last().click();
  await page.getByRole('heading', { name: 'Enviar documento' }).waitFor();
  check('cadastro e login', true);

  // 2. pasta
  await page.getByLabel('Nova pasta').fill('Contratos');
  await page.getByRole('button', { name: 'Criar pasta' }).click();
  await page
    .getByRole('button', { name: /Contratos/ })
    .first()
    .click();
  const crumb = page.getByRole('navigation', { name: 'Caminho da pasta' }).getByText('Contratos');
  await crumb.waitFor();
  check('cria e abre pasta', await crumb.isVisible());

  // 3. envio + extração no navegador
  await upload(files.contrato);
  await page.getByText('Arquivo enviado e validado.').waitFor({ timeout: 30000 });
  await page.getByRole('link', { name: 'contrato.pdf' }).waitFor();
  const row = page.locator('li', { hasText: 'contrato.pdf' });
  await row.getByText('Texto extraído').waitFor({ timeout: 15000 });
  check('envio e extração de texto do PDF no navegador', true);
  await page.screenshot({ path: join(OUT, '01-lista.png') });

  // 4. duplicado exato
  await upload(files.contrato);
  const dupAlert = page.getByRole('alert').filter({ hasText: 'idêntico' });
  await dupAlert.waitFor();
  check('avisa arquivo duplicado (mesmo SHA-256)', true);
  await page.getByRole('button', { name: 'Cancelar' }).click();

  // 5. busca
  await page.getByLabel('Busca por palavra-chave nos documentos').fill('alugue');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.getByRole('heading', { name: /Resultados para/ }).waitFor();
  const mark = page.locator('mark').first();
  await mark.waitFor();
  check(
    'busca retorna trecho com destaque',
    (await mark.textContent()).toLowerCase().startsWith('alugue'),
  );
  check('resultado indica a página', await page.getByText('Página 2').first().isVisible());
  await page.screenshot({ path: join(OUT, '02-busca.png') });

  // 6. abre o resultado: preview do PDF na página citada
  await page.getByRole('link', { name: 'contrato.pdf' }).first().click();
  await page.getByText('Página 2 de 2').waitFor({ timeout: 20000 });
  const canvasOk = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return false;
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 128) return true; // há pixels escuros (texto)
    return false;
  });
  check('preview do PDF renderiza a página citada (canvas com conteúdo)', canvasOk);
  await page.screenshot({ path: join(OUT, '03-preview.png') });
  await page.getByRole('tab', { name: 'Texto extraído' }).click();
  // escopo no cartão de pré-visualização: o cartão de análise também cita trechos do documento
  await page
    .locator('section', { has: page.getByRole('heading', { name: 'Pré-visualização' }) })
    .getByText('aluguel mensal')
    .waitFor();
  check('aba de texto extraído exibe o conteúdo', true);
  check(
    'cartão de análise estruturada aparece no documento extraído',
    await page.getByRole('heading', { name: 'Análise estruturada' }).isVisible(),
  );

  // 7. mesmo nome, conteúdo diferente → nova versão
  await page.goto(BASE);
  await page
    .getByRole('button', { name: /Contratos/ })
    .first()
    .click();
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'contrato.pdf',
      mimeType: 'application/pdf',
      buffer: makePdf(['Contrato de locacao revisado com novo prazo de vigencia']),
    });
  await page.locator('form:has(input[type=file]) button[type=submit]').first().click();
  await page.getByRole('button', { name: 'Enviar como nova versão' }).click();
  await page.getByText('Arquivo enviado e validado.').waitFor({ timeout: 30000 });
  await page.getByRole('link', { name: 'contrato.pdf' }).first().click();
  await page.getByText('Versão 2').waitFor();
  await page.getByText('Versão 1').waitFor();
  check(
    'nova versão cria histórico (v2 atual, v1 preservada)',
    await page.getByText('atual', { exact: true }).isVisible(),
  );
  // 7b. comparação v1 × v2 (no navegador, sem gravar nada)
  await page.getByRole('link', { name: 'Comparar versões' }).click();
  await page.getByRole('heading', { name: 'Comparar documentos' }).waitFor();
  check(
    'aviso de que a comparação não é parecer jurídico',
    await page
      .getByText(/não avalia validade, efeito ou legalidade/)
      .first()
      .isVisible(),
  );
  await page.getByRole('button', { name: 'Comparar', exact: true }).click();
  await page.getByText(/linhas iguais/).waitFor({ timeout: 20000 });
  const hunkLabels = await page
    .locator('li span:has-text("Removido"), li span:has-text("Alterado")')
    .count();
  check('comparação de versões mostra o que mudou no texto', hunkLabels > 0);
  await page.getByRole('tab', { name: 'Campos' }).click();
  check(
    'aba de campos explica que não são gravados nem reconferidos',
    await page.getByText(/não são gravados nem reconferidos/i).isVisible(),
  );
  await page.getByRole('tab', { name: 'Cláusulas' }).click();
  check(
    'aba de cláusulas declara que é heurística',
    await page.getByText(/heurística de melhor esforço/).isVisible(),
  );
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'CSV', exact: true }).click(),
  ]);
  check('exporta a tabela comparativa em CSV', download.suggestedFilename().endsWith('.csv'));
  await page.screenshot({ path: join(OUT, '03b-comparacao.png') });
  await page.goBack();

  // busca só enxerga a versão atual
  await page.goto(`${BASE}/?q=vigencia`);
  await page.getByRole('heading', { name: /Resultados para/ }).waitFor();
  const hitLink = page.getByRole('link', { name: 'contrato.pdf' }).first();
  await hitLink.waitFor();
  check('busca enxerga o texto da versão atual', await hitLink.isVisible());
  await page.goto(`${BASE}/?q=aluguel`);
  await page.getByText('Nenhum trecho encontrado').waitFor();
  check('texto da versão antiga não aparece na busca', true);

  // 8. PDF sem texto → needs_ocr
  await page.goto(BASE);
  await upload(files.escaneado);
  await page.getByText('Arquivo enviado e validado.').waitFor({ timeout: 30000 });
  await page
    .locator('li', { hasText: 'escaneado.pdf' })
    .getByText('Precisa de OCR')
    .waitFor({ timeout: 15000 });
  check('PDF sem camada de texto fica em needs_ocr', true);
  await page.getByRole('link', { name: 'escaneado.pdf' }).click();
  await page.getByRole('heading', { name: 'OCR no navegador (experimental)' }).waitFor();
  const startBtn = page.getByRole('button', { name: 'Reconhecer texto' });
  check('OCR exige consentimento antes de habilitar', await startBtn.isDisabled());
  await page.getByRole('checkbox').check();
  check('OCR habilita após consentimento explícito', await startBtn.isEnabled());
  await page.screenshot({ path: join(OUT, '04-ocr.png') });

  // 9. exclusão: o escaneado some da lista; o contrato some do índice de busca
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Excluir' }).first().click();
  await page.getByRole('heading', { name: 'Enviar documento' }).waitFor();
  await page
    .getByRole('button', { name: /Contratos/ })
    .first()
    .waitFor();
  check(
    'documento excluído some da lista',
    (await page.getByRole('link', { name: 'escaneado.pdf' }).count()) === 0,
  );
  await page
    .getByRole('button', { name: /Contratos/ })
    .first()
    .click();
  await page.getByRole('link', { name: 'contrato.pdf' }).click();
  await page.getByText('Versão 2').waitFor();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Excluir' }).first().click();
  await page.getByRole('heading', { name: 'Enviar documento' }).waitFor();
  await page.goto(`${BASE}/?q=vigencia`);
  await page.getByText('Nenhum trecho encontrado').waitFor();
  check('após excluir o documento, o texto some da busca', true);

  // 10. layout de celular
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(BASE);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  check('sem rolagem horizontal no celular (390px)', !overflow);
  await page.screenshot({ path: join(OUT, '05-mobile.png') });
} catch (err) {
  check('execução sem exceção', false, String(err).split('\n')[0]);
  await page.screenshot({ path: join(OUT, 'erro.png') }).catch(() => undefined);
} finally {
  const relevant = consoleErrors.filter((e) => !/favicon|status of (401|404)/.test(e));
  check(
    'sem erros no console do navegador',
    relevant.length === 0,
    relevant.slice(0, 3).join(' | '),
  );
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} verificações passaram`);
process.exit(failed.length ? 1 : 0);
