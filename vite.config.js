import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// 첨부 업로드 드라이버 — 사내 빌드(VITE_SMARTHUB_EDITION=internal)는 Supabase 업로드 코드를 번들에 넣지 않는다.
const storageDriver = fileURLToPath(new URL(
  `./src/lib/storage/${process.env.VITE_SMARTHUB_EDITION === 'internal' ? 'internal' : 'external'}.js`, import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@storage-driver': storageDriver } },
  esbuild: { jsx: 'automatic' },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js', './src/test/loopbackListen.js', './src/test/masterKeyMock.js', './src/test/authThrottleMock.js'],
    // 실DB 테스트(*.db.test.js)는 `npm run test:db`로만 — Postgres가 필요하다.
    exclude: [...configDefaults.exclude, '**/*.db.test.js'],
    globals: true,
    environmentMatchGlobs: [
      ['server/**', 'node'],
      ['src/**', 'jsdom'],
    ],
  },
})
