import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'web']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
      'react-hooks/set-state-in-effect': 'warn', // 데이터 로드 effect 패턴 — 알려진 경고로 둔다
      'react-hooks/refs': 'warn', // 최신 값 ref 패턴(비동기 콜백 stale 방지) — 알려진 경고
      'react-refresh/only-export-components': 'warn', // 상수·헬퍼를 함께 내보내는 모듈
    },
  },
  {
    files: ['server/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  // 테스트·빌드 설정 파일은 Node 런타임에서 돈다 — Node/vitest 글로벌을 허용한다.
  {
    files: ['**/*.test.{js,jsx}', 'vite.config.js', 'server/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
])
