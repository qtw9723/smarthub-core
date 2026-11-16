// supabase 구현이 쓰는 클라이언트 — 기본은 server/db.js(서비스 롤). 계약 테스트는 PostgREST 앞 프록시로 바꿔 끼운다.
import db from '../../db.js'

let override = null

export function supabaseClient() {
  return override ?? db
}

/** 계약 테스트 전용. null이면 기본으로 되돌린다. */
export function setSupabaseClientForTest(client) {
  override = client
}
