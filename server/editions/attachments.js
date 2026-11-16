// 첨부 파일 저장소 드라이버 — 외부는 Supabase Storage, 사내는 디스크(ATTACHMENTS_DIR).
//   signUpload(path) → { method: 'supabase-signed', path, token } | { method: 'server', path, uploadUrl }
//   remove(paths[]) · download(path) → { content: Buffer, contentType }
// 쓰지 않는 쪽은 import하지 않는다(사내 트리에는 외부 구현 파일이 없다).
import { edition } from '../edition.js'

export const attachments = edition() === 'internal'
  ? await import('./internal/attachments.js')
  : await import('./external/attachments.js')
