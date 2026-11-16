// 외부 에디션의 Supabase 클라이언트(서비스 롤) — 저장소 supabase 구현(server/data/supabase)과 첨부 스토리지가 쓴다.
// 처음 쓸 때 만든다: 사내 에디션(SUPABASE_URL 없음)에서 이 모듈이 import되기만 해도 서버가 죽지 않게.
import { createClient } from '@supabase/supabase-js'

let client = null
function get() {
  if (!client) {
    if (!process.env.SUPABASE_URL) throw new Error('SUPABASE_URL이 없다 — Supabase 클라이언트는 외부 에디션 전용(사내는 server/data/pg)')
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  }
  return client
}

const supabase = new Proxy({}, {
  get(_target, prop) {
    const c = get()
    const v = c[prop]
    return typeof v === 'function' ? v.bind(c) : v
  },
})

export default supabase
