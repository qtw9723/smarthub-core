// 첨부 스토리지 클라이언트의 계약.
//
// 1) 초기화 시점: 예전에는 모듈 최상단에서 createClient를 불러, 빌드타임 설정값이 없으면
//    **import하는 순간** 던졌다 — 첨부만이 아니라 메일 잡 편집 화면 전체가 죽었다.
//    그래서 지연 초기화한다.
// 2) 인가 경로(v0.5.0): 업로드 경로와 권한은 **서버**가 정한다. 예전에는 브라우저가 anon
//    키로 Storage에 직접 썼고, anon 키는 번들에 실려 나가므로 버킷이 사실상 공개였다.
import { describe, it, expect, vi, afterEach } from 'vitest'

const signUpload = vi.hoisted(() => vi.fn())
const deleteAttachment = vi.hoisted(() => vi.fn())
vi.mock('./api/mailer.js', () => ({ signUpload, deleteAttachment }))

const CTX = { hub: 'cs', password: 'pw' }

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.clearAllMocks() })

describe('설정값이 없을 때', () => {
  it('모듈을 불러오는 것만으로는 실패하지 않는다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    await expect(import('./storage.js')).resolves.toBeTruthy()
  })

  it('설정과 무관한 검증은 그대로 동작한다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    const { validateFile } = await import('./storage.js')
    expect(() => validateFile({ name: 'a.pdf', size: 1024 })).not.toThrow()
    expect(() => validateFile({ name: 'big.pdf', size: 11 * 1024 * 1024 })).toThrow(/10MB/)
  })

  it('업로드는 무엇이 없는지 말하며 실패한다 — 서명을 받기 전에 멈춘다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    const { uploadFile } = await import('./storage.js')
    await expect(uploadFile('folder', { name: 'a.pdf', size: 10 }, CTX))
      .rejects.toThrow(/VITE_SUPABASE_URL/)
    expect(signUpload).not.toHaveBeenCalled()
  })

  it('삭제는 설정 없이도 동작한다 — 지우는 주체가 서버로 옮겨갔다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    deleteAttachment.mockResolvedValue(null)
    const { deleteFile } = await import('./storage.js')
    await expect(deleteFile('folder/a.pdf', CTX)).resolves.toBeUndefined()
    expect(deleteAttachment).toHaveBeenCalledWith('folder/a.pdf', 'pw', 'cs')
  })
})

describe('업로드', () => {
  function mockSupabase(uploadToSignedUrl) {
    vi.doMock('@supabase/supabase-js', () => ({
      createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl }) } }),
    }))
  }

  it('서버가 준 경로·토큰으로 올리고, 그 경로를 그대로 돌려준다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    const uploadToSignedUrl = vi.fn().mockResolvedValue({ error: null })
    mockSupabase(uploadToSignedUrl)
    signUpload.mockResolvedValue({ path: 'hub-id/folder-uuid/abc.pdf', token: 'tok' })
    const { uploadFile } = await import('./storage.js')
    const file = { name: '보고서.pdf', size: 10 }

    const res = await uploadFile('folder-uuid', file, CTX)

    expect(signUpload).toHaveBeenCalledWith(
      { folder: 'folder-uuid', filename: '보고서.pdf', size: 10 }, 'pw', 'cs')
    expect(uploadToSignedUrl).toHaveBeenCalledWith('hub-id/folder-uuid/abc.pdf', 'tok', file)
    expect(res).toEqual({ path: 'hub-id/folder-uuid/abc.pdf', name: '보고서.pdf', size: 10 })
    vi.doUnmock('@supabase/supabase-js')
  })

  it('10MB를 넘으면 서명을 요청하지도 않는다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    mockSupabase(vi.fn())
    const { uploadFile } = await import('./storage.js')
    await expect(uploadFile('f', { name: 'big.pdf', size: 11 * 1024 * 1024 }, CTX)).rejects.toThrow(/10MB/)
    expect(signUpload).not.toHaveBeenCalled()
    vi.doUnmock('@supabase/supabase-js')
  })

  it('업로드가 실패하면 이유를 붙여 던진다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    mockSupabase(vi.fn().mockResolvedValue({ error: { message: 'network down' } }))
    signUpload.mockResolvedValue({ path: 'p', token: 't' })
    const { uploadFile } = await import('./storage.js')
    await expect(uploadFile('f', { name: 'a.pdf', size: 1 }, CTX)).rejects.toThrow(/업로드 실패.*network down/)
    vi.doUnmock('@supabase/supabase-js')
  })
})

// 사내 에디션(2026-11-09): 서버가 method: 'server'를 주면 브라우저는 그 서버로 PUT한다 — Supabase를 거치지 않는다.
describe('업로드 — 서버가 method: server를 줄 때(사내)', () => {
  it('uploadUrl로 octet-stream PUT 한 번, Supabase 업로드는 쓰지 않는다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    const uploadToSignedUrl = vi.fn()
    vi.doMock('@supabase/supabase-js', () => ({ createClient: () => ({ storage: { from: () => ({ uploadToSignedUrl }) } }) }))
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)
    signUpload.mockResolvedValue({ method: 'server', path: 'h/f/a.pdf', uploadUrl: '/api/modules/mailer/attachments/upload?path=h%2Ff%2Fa.pdf&token=1.x' })
    const { uploadFile } = await import('./storage.js')
    const file = { name: 'a.pdf', size: 3 }

    const res = await uploadFile('f', file, CTX)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/modules/mailer/attachments/upload?path=h%2Ff%2Fa.pdf&token=1.x&hub=cs')
    expect(init).toMatchObject({ method: 'PUT', body: file })
    expect(init.headers['Content-Type']).toBe('application/octet-stream')
    expect(uploadToSignedUrl).not.toHaveBeenCalled()
    expect(res).toEqual({ path: 'h/f/a.pdf', name: 'a.pdf', size: 3 })
    vi.unstubAllGlobals()
    vi.doUnmock('@supabase/supabase-js')
  })

  it('PUT이 실패하면 업로드 실패로 던진다', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '업로드 권한이 없습니다' }))
    signUpload.mockResolvedValue({ method: 'server', path: 'p', uploadUrl: '/u?path=p&token=t' })
    const { uploadFile } = await import('./storage.js')
    await expect(uploadFile('f', { name: 'a.pdf', size: 1 }, CTX)).rejects.toThrow(/업로드 실패.*권한/)
    vi.unstubAllGlobals()
  })
})
