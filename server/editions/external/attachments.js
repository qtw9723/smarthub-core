// 첨부 저장소(외부) — Supabase Storage `attachments` 버킷. mailer 라우터·smtp에 있던 호출을 그대로 옮겼다.
// 바이트는 브라우저 → Storage로 직접 간다(Vercel 요청 본문 상한 4.5MB). 서버는 서명만 준다.
import db from '../../db.js'

const bucket = () => db.storage.from('attachments')

export async function signUpload(path) {
  const { data, error } = await bucket().createSignedUploadUrl(path)
  if (error) throw error
  return { method: 'supabase-signed', path, token: data.token }
}

export async function remove(paths) {
  const { error } = await bucket().remove(paths)
  if (error) throw error
}

export async function download(path) {
  const { data, error } = await bucket().download(path)
  if (error || !data) throw new Error(`첨부파일 다운로드 실패: ${path}`)
  const buffer = await data.arrayBuffer()
  return { content: Buffer.from(buffer), contentType: data.type || 'application/octet-stream' }
}
