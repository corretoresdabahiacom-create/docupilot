import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.wrangler/**',
      '**/migrations/**',
      'apps/web/dev-dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Scripts de desenvolvimento rodam em Node.
    files: ['apps/api/e2e/**', 'apps/web/e2e/**'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        document: 'readonly',
        window: 'readonly',
      },
    },
  },
  {
    // Regex dos padrões de extração: o escape explícito de `-` e `/` em classes de caracteres é
    // mantido de propósito (legibilidade e segurança ao editar), sem efeito no comportamento.
    files: ['packages/shared/src/extraction/**'],
    rules: { 'no-useless-escape': 'off' },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
