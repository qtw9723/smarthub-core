// 저장소 진입점 — 라우터·미들웨어·스크립트는 여기의 repos만 쓴다(설계 4.1).
//   SMARTHUB_EDITION=internal → pg 구현(사내 자체 Postgres, DATABASE_URL)
//   그 밖(기본)               → supabase 구현(외부, 지금 쿼리 그대로)
// 쓰지 않는 구현은 import하지 않는다 — 사내 번들에 supabase-js가, 외부에 pg 연결이 끼지 않게.
const edition = process.env.SMARTHUB_EDITION === 'internal' ? 'internal' : 'external'

const impl = edition === 'internal' ? await import('./pg/index.js') : await import('./supabase/index.js')

export const repos = impl.repos
export { UniqueViolationError } from './errors.js'
