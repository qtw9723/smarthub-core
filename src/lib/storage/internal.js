// 첨부 업로드 드라이버(사내) — 바이트는 이 서버로 PUT한다(storage.js의 method 'server' 경로). Supabase 업로드는 없다.
export function assertConfigured() {}

export async function uploadSigned() {
  throw new Error('이 빌드(사내)에는 Supabase 업로드가 없습니다 — 서버가 method: server를 줘야 합니다')
}
