// src/lib/storage.js — 첨부 업로드/삭제.
//
// 인가는 **서버**가 한다(ROADMAP v0.5.0). 예전에는 브라우저가 anon 키로 Storage에 직접
// 쓰고 지웠는데, anon 키는 번들에 실려 나가므로 `attachments` 버킷이 사실상 공개였다
// (허브 비밀번호도, `requireHubAccess`도 지나지 않는 별도 통로였다).
//
// 바이트는 여전히 브라우저 → Storage로 직접 간다. 서버로 프록시하면 Vercel 서버리스의
// 요청 본문 상한(4.5MB)에 걸려 10MB 계약이 깨진다. 서버를 지나는 것은 인가뿐이다:
// 서버가 허브를 확인하고 경로를 만들어 서명 토큰을 주면, 그 토큰으로만 올릴 수 있다.
// 업로드 방식은 서버가 sign 응답의 method로 알려 준다.
//   'supabase-signed'(외부): 위 설명대로 브라우저 → Storage 직접. 드라이버 @storage-driver(외부 = storage/external.js)
//   'server'(사내): 브라우저 → 이 서버로 PUT(uploadUrl). 사내는 Vercel 요청 상한이 없다.
// 드라이버는 빌드할 때 정한다(VITE_SMARTHUB_EDITION=internal이면 storage/internal.js) — 사내 트리에는 external.js가 없다.
import { assertConfigured, uploadSigned } from '@storage-driver'
import { signUpload, deleteAttachment } from './api/mailer.js'
import { hubAuthHeaders } from './auth.js'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB — 서버 attachmentPath.js와 같은 값

export function validateFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`${file.name}: 파일 크기가 10MB를 초과합니다 (${(file.size / 1024 / 1024).toFixed(1)}MB)`)
  }
}

/**
 * @param {string} folderUuid 잡 하나의 첨부 묶음 (새 잡이면 임시 UUID, 기존 잡이면 잡 id)
 * @param {{hub: string, password?: string}} ctx 허브 스코프 — 서버 인가에 쓴다
 */
export async function uploadFile(folderUuid, file, { hub, password } = {}) {
  validateFile(file)
  // 설정이 없으면 서명을 요청하기 **전에** 멈춘다 — 어차피 못 올리는데 서버를 부를 이유가 없다.
  assertConfigured()
  const signed = await signUpload(
    { folder: folderUuid, filename: file.name, size: file.size }, password, hub)
  if (signed.method === 'server') {
    // 항상 octet-stream — 서버의 JSON 파서(1MB)가 .json 첨부를 먼저 가로채지 않게.
    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}${signed.uploadUrl}&hub=${encodeURIComponent(hub)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', ...hubAuthHeaders(hub), ...(password ? { 'x-app-password': password } : {}) },
      body: file,
    })
    if (!res.ok) throw new Error(`업로드 실패: ${(await res.text()) || `HTTP ${res.status}`}`)
  } else {
    await uploadSigned(signed.path, signed.token, file)
  }
  return { path: signed.path, name: file.name, size: file.size }
}

// 삭제는 서버가 서비스 롤로 수행한다 — 브라우저 Storage 설정이 없어도 동작한다.
export async function deleteFile(path, { hub, password } = {}) {
  await deleteAttachment(path, password, hub)
}
