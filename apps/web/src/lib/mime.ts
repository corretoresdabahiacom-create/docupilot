const BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
};

/** Navegadores devolvem tipo vazio para alguns arquivos (.md, .csv); completa pela extensão. */
export function guessMime(file: { name: string; type: string }): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return BY_EXTENSION[ext] ?? file.type;
}
