// 실DB 테스트 전용 설정 — `npm run test:db`. 기본 `npm test`는 *.db.test.js를 제외한다(vite.config.js).
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.db.test.js'],
    exclude: ['node_modules/**'],
    fileParallelism: false,
    // 계약 테스트는 contract DB 하나를 공유한다(시나리오마다 truncate) — 파일을 순서대로.
    testTimeout: 20000,
  },
})
