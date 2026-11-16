// 사내 첨부 저장소(디스크) — ATTACHMENTS_DIR 밖으로는 절대 나가지 않는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveSafe } from './attachments.js'

let root
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'att-')); vi.stubEnv('ATTACHMENTS_DIR', root); vi.stubEnv('ATTACHMENT_SIGNING_SECRET', 'test-secret-0123456789abcdef0123456789') })
afterEach(() => { rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs() })

describe('resolveSafe', () => {
  it('정상 경로는 root 안의 절대경로', () => {
    expect(resolveSafe(root, 'h/f/a.pdf')).toBe(join(root, 'h/f/a.pdf'))
  })
  it.each(['../x', '/etc/passwd', 'a/../../x', 'a\0b', '', 'a/./../..'])('%j 는 거부', (p) => {
    expect(() => resolveSafe(root, p)).toThrow()
  })
  // 리뷰(2026-11-09): root 안쪽이라도 정규화로 다른 허브 폴더로 넘어가는 경로는 거부한다.
  it.each(['h/../x', 'h/./a', 'h//a', 'h/a/', './h/a'])('정규화가 필요한 %j 도 거부', (p) => {
    expect(() => resolveSafe(root, p)).toThrow()
  })
  it('root 끝에 / 가 붙어도 동작한다(설정 실수 하나로 기능이 꺼지지 않게)', () => {
    expect(resolveSafe(`${root}/`, 'h/f/a.pdf')).toBe(join(root, 'h/f/a.pdf'))
  })
})

describe('write → download → remove', () => {
  it('쓴 내용 그대로 읽고, 지우면 읽기 실패 · 없는 파일 삭제는 무시', async () => {
    const m = await import('./attachments.js')
    await m.write('h/f/a.pdf', Buffer.from('PDF!'))
    const got = await m.download('h/f/a.pdf')
    expect(got.content.toString()).toBe('PDF!')
    expect(got.contentType).toBe('application/pdf')
    await m.remove(['h/f/a.pdf', 'h/f/none.txt'])
    expect(existsSync(join(root, 'h/f/a.pdf'))).toBe(false)
    await expect(m.download('h/f/a.pdf')).rejects.toThrow(/첨부파일 다운로드 실패/)
  })
  it('signUpload는 서버 업로드 주소(경로·토큰 포함)를 준다', async () => {
    const m = await import('./attachments.js')
    const r = await m.signUpload('h/f/a.pdf')
    expect(r.method).toBe('server')
    expect(r.path).toBe('h/f/a.pdf')
    const u = new URL(r.uploadUrl, 'http://x')
    expect(u.pathname).toBe('/api/modules/mailer/attachments/upload')
    expect(u.searchParams.get('path')).toBe('h/f/a.pdf')
    expect(u.searchParams.get('token')).toMatch(/^\d+\./)
  })
})
