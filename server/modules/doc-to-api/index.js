// doc-to-api 서버 모듈 — 계약: { key, apiRouter }
// 무상태 툴이라 overview(백오피스 허브 요약)가 없다 —
// server/routes/admin.js:144가 overview를 옵셔널로 다룬다.
import router from './router.js'

export default { key: 'doc-to-api', apiRouter: router }
