import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db.js', () => ({ default: { from: vi.fn() } }))
import db from '../../db.js'
import { maskToken, listSources, getSourceRaw, updateSource, deleteSource } from './sources.js'

beforeEach(() => { db.from.mockReset() })

describe('maskToken', () => {
  it('빈 값은 빈 문자열', () => {
    expect(maskToken('')).toBe('')
    expect(maskToken(null)).toBe('')
    expect(maskToken(undefined)).toBe('')
  })
  it('앞 4자만 남기고 마스킹, 원문 미노출', () => {
    const m = maskToken('glsa_abcdef123456')
    expect(m.startsWith('glsa')).toBe(true)
    expect(m).not.toContain('abcdef')
    expect(m).not.toContain('123456')
  })
})

describe('listSources', () => {
  it('정렬순 조회 + token 마스킹 + 쿼리 기본값 채움', async () => {
    const rows = [{ id: '1', hub_id: 'h', name: '운영', token: 'glsa_secretvalue', metrics: [], log_queries: [] }]
    const order = vi.fn().mockResolvedValue({ data: rows, error: null })
    const eq = vi.fn(() => ({ order }))
    const select = vi.fn(() => ({ eq }))
    db.from.mockReturnValue({ select })

    const out = await listSources('h')
    expect(eq).toHaveBeenCalledWith('hub_id', 'h')
    expect(order).toHaveBeenCalledWith('sort_order', { ascending: true })
    expect(out[0].token).not.toBe('glsa_secretvalue')
    expect(out[0].token).toContain('glsa')
    expect(out[0].metrics.length).toBeGreaterThan(0) // withQueryDefaults
  })
})

describe('분석 실패 사유는 응답에 싣지 않는다', () => {
  // 공개 허브(비밀번호 없음)에서도 /sources가 열린다. 사유 원문엔 엔드포인트·쿼터 정보가
  // 들어 있어 DB에만 둔다 — 시각은 무해하므로 남긴다.
  it('listSources가 last_analysis_error를 빼고 돌려준다', async () => {
    const rows = [{ id: '1', hub_id: 'h', name: '운영', token: '', metrics: [], log_queries: [],
      last_analysis_error: '[503] secret-ish', last_analysis_error_at: '2026-10-14T22:00:00Z' }]
    const order = vi.fn().mockResolvedValue({ data: rows, error: null })
    db.from.mockReturnValue({ select: vi.fn(() => ({ eq: vi.fn(() => ({ order })) })) })

    const out = await listSources('h')
    expect(out[0]).not.toHaveProperty('last_analysis_error')
    expect(out[0].last_analysis_error_at).toBe('2026-10-14T22:00:00Z')
  })
})

describe('getSourceRaw', () => {
  it('hub_id와 id로 스코프, 없으면 null', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const eqId = vi.fn(() => ({ maybeSingle }))
    const eqHub = vi.fn(() => ({ eq: eqId }))
    const select = vi.fn(() => ({ eq: eqHub }))
    db.from.mockReturnValue({ select })

    const out = await getSourceRaw('h', 'x')
    expect(eqHub).toHaveBeenCalledWith('hub_id', 'h')
    expect(eqId).toHaveBeenCalledWith('id', 'x')
    expect(out).toBeNull()
  })
})

describe('updateSource', () => {
  function mockRawThenUpdate(existing, updatedRow) {
    // 1st from(): getSourceRaw. 2nd from(): update chain.
    const maybeSingle = vi.fn().mockResolvedValue({ data: existing, error: null })
    const rawEqId = vi.fn(() => ({ maybeSingle }))
    const rawEqHub = vi.fn(() => ({ eq: rawEqId }))
    const rawSelect = vi.fn(() => ({ eq: rawEqHub }))

    const captured = {}
    const updSelect = vi.fn().mockResolvedValue({ data: [updatedRow], error: null })
    const updEqId = vi.fn(() => ({ select: updSelect }))
    const updEqHub = vi.fn(() => ({ eq: updEqId }))
    const update = vi.fn((payload) => { captured.payload = payload; return { eq: updEqHub } })

    db.from
      .mockReturnValueOnce({ select: rawSelect })
      .mockReturnValueOnce({ update })
    return captured
  }

  it('빈 token은 갱신 payload에서 제외(기존 유지)', async () => {
    const captured = mockRawThenUpdate(
      { id: '1', hub_id: 'h', token: 'glsa_old', metrics: [], log_queries: [] },
      { id: '1', hub_id: 'h', token: 'glsa_old', metrics: [], log_queries: [] },
    )
    await updateSource('h', '1', { name: '스테이징', token: '' })
    expect(captured.payload).not.toHaveProperty('token')
    expect(captured.payload.name).toBe('스테이징')
  })

  it('마스킹값 그대로 온 token도 제외(기존 유지)', async () => {
    const captured = mockRawThenUpdate(
      { id: '1', hub_id: 'h', token: 'glsa_old', metrics: [], log_queries: [] },
      { id: '1', hub_id: 'h', token: 'glsa_old', metrics: [], log_queries: [] },
    )
    await updateSource('h', '1', { token: 'glsa••••••••' })
    expect(captured.payload).not.toHaveProperty('token')
  })

  it('새 token은 갱신 payload에 포함', async () => {
    const captured = mockRawThenUpdate(
      { id: '1', hub_id: 'h', token: 'glsa_old', metrics: [], log_queries: [] },
      { id: '1', hub_id: 'h', token: 'glsa_new', metrics: [], log_queries: [] },
    )
    await updateSource('h', '1', { token: 'glsa_new' })
    expect(captured.payload.token).toBe('glsa_new')
  })

  it('타 허브(소유 실패)면 null', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const eqId = vi.fn(() => ({ maybeSingle }))
    const eqHub = vi.fn(() => ({ eq: eqId }))
    const select = vi.fn(() => ({ eq: eqHub }))
    db.from.mockReturnValue({ select })
    expect(await updateSource('h', 'x', { name: 'z' })).toBeNull()
  })
})

describe('deleteSource', () => {
  it('마지막 1개 소스는 삭제 거부', async () => {
    const eq = vi.fn().mockResolvedValue({ count: 1, error: null })
    const select = vi.fn(() => ({ eq }))
    db.from.mockReturnValue({ select })
    expect(await deleteSource('h', '1')).toEqual({ error: 'last-source' })
  })

  it('2개 이상이면 삭제', async () => {
    const countEq = vi.fn().mockResolvedValue({ count: 2, error: null })
    const countSelect = vi.fn(() => ({ eq: countEq }))
    const delSelect = vi.fn().mockResolvedValue({ data: [{ id: '1' }], error: null })
    const delEqId = vi.fn(() => ({ select: delSelect }))
    const delEqHub = vi.fn(() => ({ eq: delEqId }))
    const del = vi.fn(() => ({ eq: delEqHub }))
    db.from
      .mockReturnValueOnce({ select: countSelect })
      .mockReturnValueOnce({ delete: del })
    expect(await deleteSource('h', '1')).toEqual({ ok: true })
  })
})
