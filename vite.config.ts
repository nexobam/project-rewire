import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// Vite & Vitest 設定ファイル
export default defineConfig({
  base: '/project-rewire/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192.svg', 'icons/icon-512.svg'],
      manifest: {
        name: 'Project Rewire - 英語脳再配線トレーナー',
        short_name: 'Rewire',
        description: '翻訳思考を排除し、状況と音から直接英語を出力するPWAトレーニングアプリ',
        theme_color: '#F7F6F2',
        background_color: '#F7F6F2',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/project-rewire/',
        scope: '/project-rewire/',
        icons: [
          {
            src: 'icons/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
          {
            src: 'icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2,json}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/domain/**/*.ts'],
      thresholds: {
        lines: 80,
      },
    },
  },
});
