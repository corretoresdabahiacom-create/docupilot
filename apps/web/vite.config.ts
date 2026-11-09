import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'DocuPilot AI',
        short_name: 'DocuPilot',
        description: 'Organize, extraia, compare e gere documentos com rastreabilidade.',
        lang: 'pt-BR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#4f46e5',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Shell + assets em cache; a API nunca é cacheada (documentos e sessão não ficam no SW).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
        runtimeCaching: [{ urlPattern: /^\/api\//, handler: 'NetworkOnly' }],
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:8787' } },
  test: { environment: 'jsdom', setupFiles: ['./src/test-setup.ts'], globals: false },
});
