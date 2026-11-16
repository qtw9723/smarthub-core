// 에디션 — 외부(Vercel·Supabase, 기본)와 사내(k8s·자체 Postgres).2
// 'internal'일 때만 사내다. 오타·빈 값은 외부로 본다 — 외부 운영이 설정 실수로 사내 드라이버를 타지 않게.
export function edition() {
  return process.env.SMARTHUB_EDITION === 'internal' ? 'internal' : 'external'
}
