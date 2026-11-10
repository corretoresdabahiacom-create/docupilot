/**
 * DOCX, TXT, MD e CSV não têm páginas reais: o texto é dividido em "seções" de tamanho limitado
 * (preferindo quebras de parágrafo/linha) para caber nos lotes e permitir citar o trecho.
 */
export function splitIntoSections(text: string, maxChars = 6000): string[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const sections: string[] = [];
  let current = '';
  const flush = () => {
    if (current.trim()) sections.push(current.trim());
    current = '';
  };
  for (const paragraph of normalized.split(/\n{2,}/)) {
    if (paragraph.length > maxChars) {
      flush();
      // Parágrafo gigante (ex.: CSV): quebra por linha e, se preciso, no limite duro.
      for (const line of paragraph.split('\n')) {
        if (current.length + line.length + 1 > maxChars) flush();
        if (line.length > maxChars) {
          for (let i = 0; i < line.length; i += maxChars)
            sections.push(line.slice(i, i + maxChars));
        } else {
          current += `${current ? '\n' : ''}${line}`;
        }
      }
      flush();
      continue;
    }
    if (current.length + paragraph.length + 2 > maxChars) flush();
    current += `${current ? '\n\n' : ''}${paragraph}`;
  }
  flush();
  return sections;
}
