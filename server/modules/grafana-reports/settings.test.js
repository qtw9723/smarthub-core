import { describe, it, expect, vi, beforeEach } from 'vitest'

// db 모킹: hub 스코프 조회/생성/갱신을 인메모리로 흉내
const rows = new Map() // hub_id -> row
const updateCalls = [] // saveSettings가 실제 db.update()에 넘긴 payload를 그대로 기록
vi.mock('../../db.js', () => {
  const api = {
    from() { return api },
    select() { return api },
    eq(_col, val) { api._hub = val; return api },
    maybeSingle() {
      const r = rows.get(api._hub)
      return Promise.resolve({ data: r ?? null, error: null })
    },
    insert(vals) { api._ins = { hub_id: api._hub, recipients: [], send_hour: 9, enabled: true, ...vals }; return api },
    update(vals) { updateCalls.push(vals); api._upd = vals; return api },
    single() {
      if (api._ins) { rows.set(api._ins.hub_id, { ...api._ins }); const r = rows.get(api._ins.hub_id); api._ins = null; return Promise.resolve({ data: r, error: null }) }
      const cur = rows.get(api._hub)
      if (!cur) { api._upd = null; return Promise.resolve({ data: null, error: { code: 'PGRST116', message: 'no rows' } }) }
      const next = { ...cur, ...api._upd }; rows.set(api._hub, next); api._upd = null
      return Promise.resolve({ data: next, error: null })
    },
  }
  return { default: api }
})

import { getSettings, saveSettings } from './settings.js'

beforeEach(() => { rows.clear(); updateCalls.length = 0 })

describe('grafana settings (hub 스코프)', () => {
  it('설정이 없으면 기본값으로 생성해 반환하고 metrics/log_queries 기본 채움', async () => {
    const s = await getSettings('hub-cs')
    expect(s.hub_id).toBe('hub-cs')
    expect(s.send_hour).toBe(9)
    expect(s.metrics.length).toBeGreaterThan(0)      // withQueryDefaults
    expect(s.log_queries.length).toBeGreaterThan(0)
  })

  it('saveSettings는 제공된 필드만 부분 갱신한다', async () => {
    await getSettings('hub-cs')
    const s = await saveSettings('hub-cs', { send_hour: 7, recipients: ['a@x.com'] })
    expect(s.send_hour).toBe(7)
    expect(s.recipients).toEqual(['a@x.com'])
  })

  it('허브별로 독립적인 행을 갖는다', async () => {
    // 실제 SettingsPanel 흐름(GET → PUT)과 동일하게 먼저 행을 생성한 뒤 갱신한다.
    await getSettings('hub-cs')
    await getSettings('hub-team2')
    await saveSettings('hub-cs', { send_hour: 7 })
    await saveSettings('hub-team2', { send_hour: 10 })
    const cs = await getSettings('hub-cs')
    const t2 = await getSettings('hub-team2')
    expect(cs.send_hour).toBe(7)
    expect(t2.send_hour).toBe(10)
  })

  // 회귀 테스트: /tick 라우트가 saveSettings(hubId, { last_sent_date })로 당일 발송 슬롯을 선점하는데,
  // allowed 목록에서 last_sent_date가 빠지면 조용히 드롭되어 매 tick마다 중복 발송된다 (idempotency 버그).
  it('saveSettings는 last_sent_date를 실제 db.update() payload에 그대로 전달한다 (idempotency 회귀 방지)', async () => {
    await getSettings('hub-cs')
    await saveSettings('hub-cs', { last_sent_date: '2026-07-23' })

    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0]).toMatchObject({ last_sent_date: '2026-07-23' })

    // 저장 결과에도 반영되어 shouldSend가 "이미 발송됨"을 읽을 수 있어야 한다.
    const s = await getSettings('hub-cs')
    expect(s.last_sent_date).toBe('2026-07-23')
  })

  it('허용되지 않은 임의 키(bogus)는 여전히 드롭된다 (allowlist 가드 유지 확인)', async () => {
    await getSettings('hub-cs')
    await saveSettings('hub-cs', { bogus: 'nope' })

    expect(updateCalls.length).toBe(1)
    expect(updateCalls[0]).not.toHaveProperty('bogus')

    const s = await getSettings('hub-cs')
    expect(s).not.toHaveProperty('bogus')
  })
})
