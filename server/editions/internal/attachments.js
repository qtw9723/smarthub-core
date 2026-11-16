// 첨부 저장소(사내) — 디스크(ATTACHMENTS_DIR, 기본 /data/attachments). 브라우저는 서명된 주소로 이 서버에 PUT한다
// (사내는 Vercel 요청 상한이 없어 서버가 바이트를 받아도 된다). 경로는 서버가 만든 것만 쓰고, root 밖으로 나가지 못한다.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { signToken } from './uploadToken.js'

const TOKEN_TTL_MS = 10 * 60 * 1000
const TYPES = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.txt': 'text/plain', '.csv': 'text/csv', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.zip': 'application/zip' }

export const root = () => process.env.ATTACHMENTS_DIR || '/data/attachments'

function secret() {
  const s = process.env.ATTACHMENT_SIGNING_SECRET
  if (!s || s.length < 32) throw new Error('ATTACHMENT_SIGNING_SECRET이 없거나 짧다(32자 이상)')
  return s
}

/**
 * root 안의 절대경로. 비었거나·절대경로·널 바이트·root 밖이면 throw.
 * 정규화가 필요한 경로(`.`·`..`·빈 세그먼트)도 거부한다 — root 안쪽이라도 `h/../x`처럼 다른 허브 폴더로
 * 넘어갈 수 있기 때문이다(서버가 만드는 경로는 늘 `{hub}/{folder}/{file}` 정규형이다).
 */
export function resolveSafe(base, path) {
  if (typeof path !== 'string' || !path || path.includes('\0') || isAbsolute(path)) throw new Error('잘못된 첨부 경로')
  if (path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) throw new Error('잘못된 첨부 경로')
  const root = resolve(base)
  const full = normalize(join(root, path))
  if (!full.startsWith(root + sep)) throw new Error('잘못된 첨부 경로')
  return full
}

export async function signUpload(path) {
  const token = signToken(path, Date.now() + TOKEN_TTL_MS, secret())
  const q = new URLSearchParams({ path, token })
  return { method: 'server', path, uploadUrl: `/api/modules/mailer/attachments/upload?${q}` }
}

export async function write(path, buffer) {
  const full = resolveSafe(root(), path)
  await mkdir(dirname(full), { recursive: true })
  // 이미 있으면 덮어쓰지 않는다(EEXIST) — Supabase 서명 업로드(upsert 없음)와 같게. 같은 토큰을 10분 안에 다시 써도 바뀌지 않는다.
  await writeFile(full, buffer, { flag: 'wx' })
}

export async function remove(paths) {
  for (const p of paths) await rm(resolveSafe(root(), p), { force: true })
}

export async function download(path) {
  try {
    const content = await readFile(resolveSafe(root(), path))
    return { content, contentType: TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream' }
  } catch {
    throw new Error(`첨부파일 다운로드 실패: ${path}`)
  }
}

export { secret as signingSecret }
