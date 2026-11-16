// 첨부 업로드 드라이버(외부) — Supabase Storage 서명 업로드. supabase-js는 이 파일에서만 import한다
// (사내 빌드는 vite.config.js의 @storage-driver 별칭이 internal.js를 가리켜 이 파일이 번들에 들어가지 않는다).
import { createClient } from '@supabase/supabase-js'

// 클라이언트는 **처음 쓸 때** 만든다 — 빌드타임 설정값이 없을 때 import만으로 화면 전체가 죽지 않게.
let client = null
function bucket() {
  if (!client) {
    assertConfigured()
    client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
  }
  return client.storage.from('attachments')
}

/** 업로드 설정이 없으면 서명을 받기 **전에** 무엇이 없는지 말하며 멈춘다. */
export function assertConfigured() {
  if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
    throw new Error('첨부 파일 기능 설정이 없습니다 (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)')
  }
}

export async function uploadSigned(path, token, file) {
  const { error } = await bucket().uploadToSignedUrl(path, token, file)
  if (error) throw new Error(`업로드 실패: ${error.message}`)
}
