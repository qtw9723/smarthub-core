// server/modules/mailer/attachmentPath.js — 첨부 저장 경로 규칙.
//
// 왜 서버가 경로를 만드는가: 예전에는 브라우저가 경로를 정해 anon 키로 직접 올렸다.
// 그래서 누구든 `attachments` 버킷 어디에나 쓰고 지울 수 있었다(anon 키는 번들에 실려 나간다).
// 이제 서버가 허브를 확인한 뒤 경로를 만들어 서명 토큰만 내주므로, **클라이언트는 접두사를
// 고를 수 없다** — 허브 간 침범이 규칙이 아니라 구조로 막힌다.
//
// 경로 모양: `{hubId}/{folder}/{랜덤}.{확장자}`
//   - `folder`는 잡 하나의 첨부 묶음(새 잡이면 브라우저가 만든 UUID, 기존 잡이면 잡 id).
//   - 구 경로는 `{folder}/{랜덤}.{확장자}` 2단이라 허브를 알 수 없다(hubIdOfPath → null).
//     기존 5건이 여기 해당하며, 소유 판정은 "이 허브 잡이 참조하는가"로 대신한다.
import { randomUUID } from 'node:crypto'

export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB — 클라이언트 validateFile과 같은 값

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_EXT_LENGTH = 16

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v)

/**
 * 파일명에서 저장에 쓸 확장자만 뽑는다.
 * 확장자는 원래 이름이 아니라 **경로의 일부**가 되므로, 슬래시가 섞이면 경로가 한 단 더
 * 깊어져 소유 판정(앞 세그먼트 = 허브)이 어긋난다. 그래서 영숫자만 남기고 길이도 자른다.
 * 원본 파일명은 DB(`mail_jobs.attachments[].name`)에 그대로 남으므로 표시에는 영향이 없다.
 */
function safeExtension(filename) {
  if (!filename.includes('.')) return ''
  const raw = filename.split('.').pop()
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, '')
  return cleaned.slice(0, MAX_EXT_LENGTH)
}

export function buildAttachmentPath(hubId, folder, filename) {
  const ext = safeExtension(filename)
  const storageName = ext ? `${randomUUID()}.${ext}` : randomUUID()
  return `${hubId}/${folder}/${storageName}`
}

/** 문제가 있으면 사람이 읽을 메시지를, 없으면 null을 준다. */
export function validateUploadRequest({ folder, filename, size }) {
  if (!isUuid(folder)) return '폴더 형식이 올바르지 않습니다'
  if (typeof filename !== 'string' || filename.trim() === '') return '파일명이 필요합니다'
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0) return '파일 크기가 올바르지 않습니다'
  if (size > MAX_FILE_SIZE) return '파일 크기가 10MB를 초과합니다'
  return null
}

/** 새 경로면 앞 세그먼트(허브 id), 구 경로(2단)면 null. */
export function hubIdOfPath(path) {
  if (typeof path !== 'string') return null
  const parts = path.split('/')
  if (parts.length !== 3) return null
  return isUuid(parts[0]) ? parts[0] : null
}
