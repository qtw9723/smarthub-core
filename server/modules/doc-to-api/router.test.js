// doc-to-api 프록시 라우터 — 상류(문서 파싱 서비스) fetch를 mock해 4경로를 검증한다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import express from 'express'

// requireHubAccess가 hubs를 조회한다 — 이 모듈 자체는 DB를 쓰지 않지만 미들웨어가 쓴다.
const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('../../db.js', () => ({ default: { from: mockFrom } }))

import router from './router.js'
import { hashPassword } from '../../lib/hubPassword.js'

const CS_HASH = hashPassword('cs-pw')

// 이 라우터가 거치는 세 테이블을 한 mock으로 디스패치한다:
//   hubs(인증·기능확인) · hub_features(기능 on/off) · hub_module_calls(호출 상한)
let insertedCall
function dbState({ hub, feature = { enabled: true }, callCount = 0 } = {}) {
  insertedCall = undefined
  mockFrom.mockImplementation(table => {
    if (table === 'hub_module_calls') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ count: callCount, error: null }),
        insert: vi.fn(row => { insertedCall = row; return Promise.resolve({ error: null }) }),
      }
    }
    const row = table === 'hubs' ? hub : feature
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    }
  })
}

// 공개 허브(비밀번호 없음) + 기능 켜짐 — 대부분의 테스트가 서는 기본 상태.
const OPEN_HUB = { id: 'hub-cs-uuid', key: 'cs', name: 'CS', enabled: true, password_hash: null }
function openHub(extra) { dbState({ hub: OPEN_HUB, ...extra }) }

const app = express()
app.use(express.json())
app.use('/api/modules/doc-to-api', router)

const PW = 'test-password'

beforeEach(() => {
  openHub()
  process.env.APP_PASSWORD = PW
  process.env.DOC_PARSE_URL = 'https://parser.example.com/v1'
  process.env.DOC_PARSE_KEY = 'anon-key-xyz'
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function upstreamOk(defs) {
  return { ok: true, status: 200, json: async () => ({ defs }) }
}

describe('POST /parse', () => {
  // 인증 경계: 이 모듈 API는 **대상 허브의 비밀번호**를 요구한다.
  // ⚠ 여러 모듈 중 이 경로만 외부 비용(상류 LLM 호출, 그쪽 계정 청구)을 발생시키므로,
  // 인증을 우회하는 길이 없어야 한다.
  it('hub를 안 주면 400이고 상류를 호출하지 않는다 — ?hub= 생략으로 우회 금지', async () => {
    const res = await request(app).post('/api/modules/doc-to-api/parse')
      .set('x-app-password', 'wrong').send({ text: 'hi' })
    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('비밀번호가 걸린 허브는 401이고 상류를 호출하지 않는다 — 비용이 나가지 않는다', async () => {
    dbState({ hub: { ...OPEN_HUB, password_hash: CS_HASH } })
    const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs')
      .set('x-app-password', 'wrong').send({ text: 'hi' })
    expect(res.status).toBe(401)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('없는 허브는 404이고 상류를 호출하지 않는다', async () => {
    dbState({ hub: null })
    const res = await request(app).post('/api/modules/doc-to-api/parse?hub=nope').send({ text: 'hi' })
    expect(res.status).toBe(404)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('맞는 허브 비밀번호면 통과한다', async () => {
    dbState({ hub: { ...OPEN_HUB, password_hash: CS_HASH } })
    global.fetch.mockResolvedValue(upstreamOk([{ name: 'x' }]))
    const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs')
      .set('x-hub-password', 'cs-pw').send({ text: 'hi' })
    expect(res.status).toBe(200)
  })

  it('비밀번호가 없는 허브는 공개 — 그대로 통과한다', async () => {
    dbState({ hub: { ...OPEN_HUB, key: 'ops', name: 'Ops' } })
    global.fetch.mockResolvedValue(upstreamOk([]))
    const res = await request(app).post('/api/modules/doc-to-api/parse?hub=ops').send({ text: 'hi' })
    expect(res.status).toBe(200)
  })

  it('text가 없으면 400이고 상류를 호출하지 않는다', async () => {
    const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs')
      .set('x-app-password', PW).send({})
    expect(res.status).toBe(400)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('text가 공백뿐이면 400', async () => {
    const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs')
      .set('x-app-password', PW).send({ text: '   ' })
    expect(res.status).toBe(400)
  })

  it('정상이면 상류 defs를 그대로 통과시킨다', async () => {
    const defs = [{ name: 'createOrder', method: 'POST' }]
    global.fetch.mockResolvedValue(upstreamOk(defs))

    const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs')
      .set('x-app-password', PW).send({ text: 'POST /v1/orders' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ defs })

    // 상류 호출이 상류 계약대로 조립됐는지 확인
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('https://parser.example.com/v1/api-doc-parse')
    expect(opts.method).toBe('POST')
    expect(opts.headers.Authorization).toBe('Bearer anon-key-xyz')
    expect(JSON.parse(opts.body)).toEqual({ text: 'POST /v1/orders' })
  })

  it('상류가 실패하면 502와 상류 상태코드를 반환한다', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 503, text: async () => 'upstream down' })

    const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs')
      .set('x-app-password', PW).send({ text: 'hi' })

    expect(res.status).toBe(502)
    expect(res.body.upstreamStatus).toBe(503)
  })

  it('상류 네트워크 오류도 502로 매핑된다', async () => {
    global.fetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs')
      .set('x-app-password', PW).send({ text: 'hi' })

    expect(res.status).toBe(502)
  })

  it('상류가 응답하지 않아 타임아웃되면 친절한 502로 매핑된다', async () => {
    // 45초를 실제로 기다리지 않는다 — AbortSignal.timeout이 던지는 것과 같은 종류의
    // 오류(TimeoutError DOMException)로 fetch를 즉시 reject시켜 catch 경로만 검증한다.
    global.fetch.mockImplementation(() => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })

    const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs')
      .set('x-app-password', PW).send({ text: 'hi' })

    expect(res.status).toBe(502)
    expect(res.body.error).toBe('자유형식 문서 추출에 실패했습니다. OpenAPI 파일은 계속 사용할 수 있습니다.')
    expect(res.body.upstreamStatus).toBe(0)
  })

  it('AbortError(취소)도 같은 502 경로를 탄다', async () => {
    global.fetch.mockRejectedValue(new DOMException('This operation was aborted', 'AbortError'))

    const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs')
      .set('x-app-password', PW).send({ text: 'hi' })

    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/OpenAPI 파일은 계속 사용할 수 있습니다/)
  })

  it('상류 fetch에 타임아웃 signal이 붙는다', async () => {
    global.fetch.mockResolvedValue(upstreamOk([]))

    await request(app).post('/api/modules/doc-to-api/parse?hub=cs')
      .set('x-app-password', PW).send({ text: 'hi' })

    const [, opts] = global.fetch.mock.calls[0]
    expect(opts.signal).toBeInstanceOf(AbortSignal)
  })

  it('502 응답에 상류 본문(detail)을 실어 보내지 않는다', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'upstream stack trace…' })

    const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs')
      .set('x-app-password', PW).send({ text: 'hi' })

    expect(res.status).toBe(502)
    expect(res.body.detail).toBeUndefined()
    expect(JSON.stringify(res.body)).not.toContain('upstream stack trace')
  })

  it('env가 없으면 500', async () => {
    delete process.env.DOC_PARSE_URL
    const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs')
      .set('x-app-password', PW).send({ text: 'hi' })
    expect(res.status).toBe(500)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  // ---- 기능 활성 확인 --------------------------------------------------------
  // 비밀번호만 보고 통과시키면, 이 도구를 켠 적 없는 허브 이름을 붙이는 것만으로
  // 외부 청구가 발생한다(공개 허브면 무인증으로). 백오피스의 on/off가 실제 경계여야 한다.
  describe('허브에서 이 기능이 꺼져 있으면', () => {
    it('404이고 상류를 호출하지 않는다', async () => {
      dbState({ hub: OPEN_HUB, feature: { enabled: false } })
      const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs').send({ text: 'hi' })
      expect(res.status).toBe(404)
      expect(res.body.error).toBe('feature not enabled')
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('한 번도 켠 적 없는(행 없음) 허브도 404', async () => {
      dbState({ hub: OPEN_HUB, feature: null })
      const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs').send({ text: 'hi' })
      expect(res.status).toBe(404)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('마스터키로도 뚫리지 않는다 — 인증 우회는 기능 사용 허가가 아니다', async () => {
      dbState({ hub: OPEN_HUB, feature: { enabled: false } })
      const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs')
        .set('x-app-password', PW).send({ text: 'hi' })
      expect(res.status).toBe(404)
      expect(global.fetch).not.toHaveBeenCalled()
    })
  })

  // ---- 호출 상한 -------------------------------------------------------------
  describe('허브 호출 상한', () => {
    it('상한을 넘기면 429이고 상류를 호출하지 않는다', async () => {
      process.env.DOC_TO_API_HOURLY_LIMIT = '2'
      openHub({ callCount: 2 })
      const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs').send({ text: 'hi' })
      expect(res.status).toBe(429)
      expect(global.fetch).not.toHaveBeenCalled()
    })

    it('상한 이내면 상류를 호출하고 그 호출을 기록한다', async () => {
      process.env.DOC_TO_API_HOURLY_LIMIT = '2'
      openHub({ callCount: 1 })
      global.fetch.mockResolvedValue(upstreamOk([]))
      const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs').send({ text: 'hi' })
      expect(res.status).toBe(200)
      expect(insertedCall).toMatchObject({ hub_id: OPEN_HUB.id, feature_key: 'doc-to-api' })
    })

    it('text가 비어 거절되는 요청은 상한을 소모하지 않는다', async () => {
      openHub()
      const res = await request(app).post('/api/modules/doc-to-api/parse?hub=cs').send({ text: '  ' })
      expect(res.status).toBe(400)
      expect(insertedCall).toBeUndefined()
    })
  })
})
