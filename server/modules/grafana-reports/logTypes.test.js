// server/modules/grafana-reports/logTypes.test.js
// 각 함수가 hubId + sourceId를 쿼리에 반영하고, 타 허브/타 소스 소유 자원에 대해서는
// null을 반환(수정/삭제 차단)하는지 검증. 유형은 (hub_id, source_id) 스코프.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('../../db.js', () => ({ default: { from: mockFrom } }))

function mockQuery(result) {
  const p = Promise.resolve(result)
  return {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    then: (resolve, reject) => p.then(resolve, reject),
  }
}

const { listTypes, listTypesWithHistory, getType, updateType, deleteType, updateRun, resolveAndPersist } = await import('./logTypes.js')

const SRC = 'src-1'
// 유형이 하나라도 있으면 resolveAndPersist는 '오늘 이미 적재된 회차'를 한 번 조회한다.
const noRunsToday = () => mockQuery({ data: [], error: null })
beforeEach(() => { vi.clearAllMocks(); mockFrom.mockReset() })

describe('listTypes(hubId, sourceId)', () => {
  it('hub_id + source_id로 필터해 유형 목록 반환', async () => {
    const q = mockQuery({ data: [{ id: 't1', label: 'A', hub_id: 'hub-cs', source_id: SRC }], error: null })
    mockFrom.mockReturnValueOnce(q)
    const r = await listTypes('hub-cs', SRC)
    expect(q.eq).toHaveBeenCalledWith('hub_id', 'hub-cs')
    expect(q.eq).toHaveBeenCalledWith('source_id', SRC)
    expect(r).toEqual([{ id: 't1', label: 'A', hub_id: 'hub-cs', source_id: SRC }])
  })
})

describe('listTypesWithHistory(hubId, sourceId, opts)', () => {
  it('유형별 KST 날짜 합산 추세를 최신순 maxPoints개 붙임 + runs는 해당 유형 id로 필터', async () => {
    const typesQ = mockQuery({ data: [{ id: 't1', label: 'A' }, { id: 't2', label: 'B' }], error: null })
    const runsQ = mockQuery({ data: [
      { type_id: 't1', run_at: '2026-07-01T23:00:00Z', count: 3 }, // KST 2026-07-02
      { type_id: 't1', run_at: '2026-07-01T22:00:00Z', count: 2 }, // KST 2026-07-02 → 합산 5
      { type_id: 't1', run_at: '2026-06-30T23:00:00Z', count: 4 }, // KST 2026-07-01
    ], error: null })
    mockFrom.mockReturnValueOnce(typesQ).mockReturnValueOnce(runsQ)
    const r = await listTypesWithHistory('hub-cs', SRC)
    expect(typesQ.eq).toHaveBeenCalledWith('hub_id', 'hub-cs')
    expect(typesQ.eq).toHaveBeenCalledWith('source_id', SRC)
    expect(runsQ.in).toHaveBeenCalledWith('type_id', ['t1', 't2'])
    expect(r[0].recentRuns).toEqual([
      { date: '2026-07-02', count: 5 },
      { date: '2026-07-01', count: 4 },
    ])
    expect(r[1].recentRuns).toEqual([])
  })

  it('maxPoints 초과 날짜는 절단', async () => {
    const typesQ = mockQuery({ data: [{ id: 't1', label: 'A' }], error: null })
    const runs = [6, 5, 4, 3, 2, 1].map((d) => (
      { type_id: 't1', run_at: `2026-06-2${d}T03:00:00Z`, count: d }
    ))
    mockFrom.mockReturnValueOnce(typesQ).mockReturnValueOnce(mockQuery({ data: runs, error: null }))
    const r = await listTypesWithHistory('hub-cs', SRC, { maxPoints: 5 })
    expect(r[0].recentRuns).toHaveLength(5)
    expect(r[0].recentRuns[0].date).toBe('2026-06-26')
  })

  it('추세 조회 실패 시 recentRuns 빈 배열로 폴백(throw 안 함)', async () => {
    const typesQ = mockQuery({ data: [{ id: 't1', label: 'A' }], error: null })
    mockFrom.mockReturnValueOnce(typesQ).mockReturnValueOnce(mockQuery({ data: null, error: new Error('db down') }))
    const r = await listTypesWithHistory('hub-cs', SRC)
    expect(r).toEqual([{ id: 't1', label: 'A', recentRuns: [] }])
  })

  it('유형이 없으면 runs 조회 없이 빈 배열', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: [], error: null }))
    expect(await listTypesWithHistory('hub-cs', SRC)).toEqual([])
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })
})

describe('getType(hubId, sourceId, id)', () => {
  it('타 허브/타 소스 소유 유형이면 null (스코프 불일치로 maybeSingle이 null 반환)', async () => {
    const q = mockQuery({ data: null, error: null })
    mockFrom.mockReturnValueOnce(q)
    const r = await getType('hub-cs', SRC, 't1')
    expect(q.eq).toHaveBeenCalledWith('id', 't1')
    expect(q.eq).toHaveBeenCalledWith('hub_id', 'hub-cs')
    expect(q.eq).toHaveBeenCalledWith('source_id', SRC)
    expect(r).toBeNull()
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('본인 허브/소스 유형이면 유형 + runs + entries 병합', async () => {
    mockFrom
      .mockReturnValueOnce(mockQuery({ data: { id: 't1', label: 'A', hub_id: 'hub-cs', source_id: SRC }, error: null }))
      .mockReturnValueOnce(mockQuery({ data: [{ id: 1, count: 3 }], error: null }))
      .mockReturnValueOnce(mockQuery({ data: [{ id: 9, occurred_at: '2026-06-24T05:00:00Z', msg: 'm' }], error: null }))
    const r = await getType('hub-cs', SRC, 't1')
    expect(r.label).toBe('A')
    expect(r.runs).toEqual([{ id: 1, count: 3 }])
    expect(r.entries).toEqual([{ id: 9, occurred_at: '2026-06-24T05:00:00Z', msg: 'm' }])
  })
})

describe('updateType(hubId, sourceId, id, fields)', () => {
  it('본인 허브/소스 유형이면 note 갱신', async () => {
    const ownQ = mockQuery({ data: { id: 't1', label: 'A', hub_id: 'hub-cs', source_id: SRC }, error: null })
    const runsQ = mockQuery({ data: [], error: null })
    const entriesQ = mockQuery({ data: [], error: null })
    const updQ = mockQuery({ data: [{ id: 't1', note: 'hi' }], error: null })
    mockFrom.mockReturnValueOnce(ownQ).mockReturnValueOnce(runsQ).mockReturnValueOnce(entriesQ).mockReturnValueOnce(updQ)
    const r = await updateType('hub-cs', SRC, 't1', { note: 'hi', bogus: 'x' })
    expect(updQ.update).toHaveBeenCalledWith(expect.objectContaining({ note: 'hi' }))
    expect(updQ.update.mock.calls[0][0]).not.toHaveProperty('bogus')
    expect(r.note).toBe('hi')
  })

  it('타 허브/타 소스 소유 유형이면 null 반환, update 쿼리 자체를 보내지 않음', async () => {
    const ownQ = mockQuery({ data: null, error: null })
    mockFrom.mockReturnValueOnce(ownQ)
    const r = await updateType('hub-other', SRC, 't1', { note: 'x' })
    expect(r).toBeNull()
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('없으면 null', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: null, error: null }))
    expect(await updateType('hub-cs', SRC, 'x', { note: 'a' })).toBeNull()
  })
})

describe('deleteType(hubId, sourceId, id)', () => {
  it('본인 허브/소스 유형이면 삭제', async () => {
    const ownQ = mockQuery({ data: { id: 't1', label: 'A', hub_id: 'hub-cs', source_id: SRC }, error: null })
    const runsQ = mockQuery({ data: [], error: null })
    const entriesQ = mockQuery({ data: [], error: null })
    const delQ = mockQuery({ error: null })
    mockFrom.mockReturnValueOnce(ownQ).mockReturnValueOnce(runsQ).mockReturnValueOnce(entriesQ).mockReturnValueOnce(delQ)
    await deleteType('hub-cs', SRC, 't1')
    expect(delQ.delete).toHaveBeenCalled()
    expect(delQ.eq).toHaveBeenCalledWith('id', 't1')
  })

  it('타 허브/타 소스 소유 유형이면 삭제 쿼리를 보내지 않고 null 반환', async () => {
    const ownQ = mockQuery({ data: null, error: null })
    mockFrom.mockReturnValueOnce(ownQ)
    const r = await deleteType('hub-other', SRC, 't1')
    expect(r).toBeNull()
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })
})

describe('updateRun(hubId, sourceId, runId, note)', () => {
  it('run의 유형이 본인 허브/소스 소유면 메모 저장', async () => {
    const runQ = mockQuery({ data: { id: 5, type_id: 't1' }, error: null })
    const typeQ = mockQuery({ data: { id: 't1' }, error: null })
    const updQ = mockQuery({ data: [{ id: 5, note: '확인함' }], error: null })
    mockFrom.mockReturnValueOnce(runQ).mockReturnValueOnce(typeQ).mockReturnValueOnce(updQ)
    const r = await updateRun('hub-cs', SRC, 5, '확인함')
    expect(typeQ.eq).toHaveBeenCalledWith('hub_id', 'hub-cs')
    expect(typeQ.eq).toHaveBeenCalledWith('source_id', SRC)
    expect(updQ.update).toHaveBeenCalledWith({ note: '확인함' })
    expect(updQ.eq).toHaveBeenCalledWith('id', 5)
    expect(r.note).toBe('확인함')
  })

  it('run의 유형이 타 허브/타 소스 소유면 null 반환, update 쿼리를 보내지 않음', async () => {
    const runQ = mockQuery({ data: { id: 5, type_id: 't1' }, error: null })
    const typeQ = mockQuery({ data: null, error: null })
    mockFrom.mockReturnValueOnce(runQ).mockReturnValueOnce(typeQ)
    const r = await updateRun('hub-other', SRC, 5, '확인함')
    expect(r).toBeNull()
    expect(mockFrom).toHaveBeenCalledTimes(2)
  })

  it('없는 회차면 null', async () => {
    mockFrom.mockReturnValueOnce(mockQuery({ data: null, error: null }))
    expect(await updateRun('hub-cs', SRC, 999, 'x')).toBeNull()
  })
})

describe('resolveAndPersist(hubId, sourceId, analysis, runAt, logs)', () => {
  it('기존 유형(스코프 내) 매칭 시 신규 생성 없이 회차 적재 + 누적 갱신', async () => {
    const listQ = mockQuery({ data: [{ id: 't1', label: '타임아웃', total_count: 10, hub_id: 'hub-cs', source_id: SRC }], error: null })
    const runInsQ = mockQuery({ data: { id: 1 }, error: null })
    const updQ = mockQuery({ error: null })
    mockFrom.mockReturnValueOnce(listQ).mockReturnValueOnce(noRunsToday()).mockReturnValueOnce(runInsQ).mockReturnValueOnce(updQ)
    await resolveAndPersist('hub-cs', SRC, { types: [{ label: '타임아웃', app: 'soe', count: 5, rows: [], existingMatch: '타임아웃' }] }, '2026-06-24T00:00:00Z')
    expect(listQ.eq).toHaveBeenCalledWith('hub_id', 'hub-cs')
    expect(listQ.eq).toHaveBeenCalledWith('source_id', SRC)
    expect(runInsQ.insert).toHaveBeenCalledWith(expect.objectContaining({ type_id: 't1', app: 'soe', count: 5 }))
    expect(updQ.update).toHaveBeenCalledWith(expect.objectContaining({ total_count: 15 }))
  })

  it('신규 유형이면 hub_id + source_id를 포함해 생성 후 적재', async () => {
    const listQ = mockQuery({ data: [], error: null })
    const insTypeQ = mockQuery({ data: { id: 'new1', label: '신규', total_count: 0, hub_id: 'hub-cs', source_id: SRC }, error: null })
    const runInsQ = mockQuery({ data: { id: 2 }, error: null })
    const updQ = mockQuery({ error: null })
    mockFrom.mockReturnValueOnce(listQ).mockReturnValueOnce(insTypeQ).mockReturnValueOnce(runInsQ).mockReturnValueOnce(updQ)
    await resolveAndPersist('hub-cs', SRC, { types: [{ label: '신규', app: 'c3', count: 2, rows: [] }] }, '2026-06-24T00:00:00Z')
    expect(insTypeQ.insert).toHaveBeenCalledWith(expect.objectContaining({ label: '신규', hub_id: 'hub-cs', source_id: SRC }))
    expect(runInsQ.insert).toHaveBeenCalledWith(expect.objectContaining({ type_id: 'new1', count: 2 }))
    expect(updQ.update).toHaveBeenCalledWith(expect.objectContaining({ total_count: 2 }))
  })

  it('rows[] 인덱스를 ES 원본 행으로 되살려 entries 적재(범위 밖 무시, ts→occurred_at)', async () => {
    const listQ = mockQuery({ data: [{ id: 't1', label: 'A', total_count: 0, hub_id: 'hub-cs', source_id: SRC }], error: null })
    const runInsQ = mockQuery({ data: { id: 7 }, error: null })
    const entInsQ = mockQuery({ error: null })
    const updQ = mockQuery({ error: null })
    mockFrom.mockReturnValueOnce(listQ).mockReturnValueOnce(noRunsToday()).mockReturnValueOnce(runInsQ).mockReturnValueOnce(entInsQ).mockReturnValueOnce(updQ)
    const logs = [{ app: 'soe', count: 3, error: null, rows: [
      { ts: 'T0', time: 't0', msg: 'm0' }, { ts: 'T1', time: 't1', msg: 'm1' }, { ts: 'T2', time: 't2', msg: 'm2' },
    ] }]
    await resolveAndPersist('hub-cs', SRC, { types: [{ label: 'A', app: 'soe', count: 3, rows: [0, 2, 99], existingMatch: 'A' }] }, '2026-06-24T00:00:00Z', logs)
    expect(entInsQ.insert).toHaveBeenCalledWith([
      { type_id: 't1', run_id: 7, app: 'soe', occurred_at: 'T0', msg: 'm0' },
      { type_id: 't1', run_id: 7, app: 'soe', occurred_at: 'T2', msg: 'm2' },
    ])
  })

  it('types 비면 아무 것도 안 함(스코프 list만 조회)', async () => {
    const listQ = mockQuery({ data: [], error: null })
    mockFrom.mockReturnValueOnce(listQ)
    await resolveAndPersist('hub-cs', SRC, { types: [] }, '2026-06-24T00:00:00Z')
    expect(listQ.eq).toHaveBeenCalledWith('hub_id', 'hub-cs')
    expect(listQ.eq).toHaveBeenCalledWith('source_id', SRC)
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })

  it('aiNote 있으면 ai_note 갱신, 빈 문자열이면 기존 유지', async () => {
    const listQ = mockQuery({ data: [
      { id: 't1', label: 'A', total_count: 1, hub_id: 'hub-cs', source_id: SRC },
      { id: 't2', label: 'B', total_count: 1, hub_id: 'hub-cs', source_id: SRC },
    ], error: null })
    const run1 = mockQuery({ data: { id: 1 }, error: null })
    const upd1 = mockQuery({ error: null })
    const run2 = mockQuery({ data: { id: 2 }, error: null })
    const upd2 = mockQuery({ error: null })
    mockFrom.mockReturnValueOnce(listQ).mockReturnValueOnce(noRunsToday())
      .mockReturnValueOnce(run1).mockReturnValueOnce(upd1)
      .mockReturnValueOnce(run2).mockReturnValueOnce(upd2)
    await resolveAndPersist('hub-cs', SRC, { types: [
      { label: 'A', app: 'x', count: 1, rows: [], existingMatch: 'A', aiNote: '추세 증가' },
      { label: 'B', app: 'x', count: 1, rows: [], existingMatch: 'B', aiNote: '' },
    ] }, '2026-07-02T00:00:00Z')
    expect(upd1.update).toHaveBeenCalledWith(expect.objectContaining({ ai_note: '추세 증가' }))
    expect(upd2.update.mock.calls[0][0]).not.toHaveProperty('ai_note')
  })
})

// 유형 매칭은 예전에 **라벨 문자열의 정확한 일치**에만 의존했다. 라벨은 운영자가 편집할 수
// 있고(PATCH /log-types/:id), 매칭 후보는 LLM이 만들어 돌려주는 문자열이다. 둘 중 하나만
// 어긋나도 같은 오류가 새 유형으로 갈라져 누적·추세가 끊긴다. 이제 id로 먼저 맞춘다.
describe('resolveAndPersist — 유형 매칭', () => {
  const EXISTING = { id: 't1', label: '운영자가 고친 이름', total_count: 10, hub_id: 'hub-cs', source_id: SRC }

  function wire(existing = [EXISTING]) {
    const listQ = mockQuery({ data: existing, error: null })
    const insTypeQ = mockQuery({ data: { id: 'NEW', label: 'x', total_count: 0 }, error: null })
    const runInsQ = mockQuery({ data: { id: 9 }, error: null })
    const updQ = mockQuery({ error: null })
    mockFrom.mockReturnValueOnce(listQ).mockReturnValueOnce(noRunsToday()).mockReturnValueOnce(runInsQ).mockReturnValueOnce(updQ)
    return { listQ, insTypeQ, runInsQ, updQ }
  }

  it('라벨이 편집돼 있어도 existingMatchId로 같은 유형에 이어 붙인다', async () => {
    const { insTypeQ, runInsQ } = wire()
    await resolveAndPersist('hub-cs', SRC, {
      types: [{ label: 'AI가 새로 지은 이름', app: 'soe', count: 5, rows: [], existingMatchId: 't1' }],
    }, '2026-06-24T00:00:00Z')
    expect(insTypeQ.insert).not.toHaveBeenCalled()
    expect(runInsQ.insert).toHaveBeenCalledWith(expect.objectContaining({ type_id: 't1' }))
  })

  it('id가 맞으면 저장된 라벨을 유지한다 — 운영자가 고친 이름을 AI가 덮어쓰지 않는다', async () => {
    const { updQ } = wire()
    await resolveAndPersist('hub-cs', SRC, {
      types: [{ label: 'AI가 새로 지은 이름', app: 'soe', count: 1, rows: [], existingMatchId: 't1' }],
    }, '2026-06-24T00:00:00Z')
    expect(updQ.update).toHaveBeenCalledWith(expect.not.objectContaining({ label: expect.anything() }))
  })

  it('id가 없으면 예전처럼 라벨로 맞춘다 — 하위호환', async () => {
    const { insTypeQ, runInsQ } = wire()
    await resolveAndPersist('hub-cs', SRC, {
      types: [{ label: 'x', app: 'soe', count: 1, rows: [], existingMatch: '운영자가 고친 이름' }],
    }, '2026-06-24T00:00:00Z')
    expect(insTypeQ.insert).not.toHaveBeenCalled()
    expect(runInsQ.insert).toHaveBeenCalledWith(expect.objectContaining({ type_id: 't1' }))
  })

  it('앞뒤 공백·중복 공백만 다른 라벨도 같은 유형으로 본다', async () => {
    const { insTypeQ, runInsQ } = wire()
    await resolveAndPersist('hub-cs', SRC, {
      types: [{ label: '  운영자가  고친 이름 ', app: 'soe', count: 1, rows: [] }],
    }, '2026-06-24T00:00:00Z')
    expect(insTypeQ.insert).not.toHaveBeenCalled()
    expect(runInsQ.insert).toHaveBeenCalledWith(expect.objectContaining({ type_id: 't1' }))
  })

  it('모르는 id를 주면 새로 만든다 — 잘못된 id로 남의 유형에 붙지 않는다', async () => {
    const listQ = mockQuery({ data: [EXISTING], error: null })
    const insTypeQ = mockQuery({ data: { id: 'NEW', label: '진짜 신규', total_count: 0 }, error: null })
    const runInsQ = mockQuery({ data: { id: 9 }, error: null })
    const updQ = mockQuery({ error: null })
    mockFrom.mockReturnValueOnce(listQ).mockReturnValueOnce(noRunsToday())
      .mockReturnValueOnce(insTypeQ).mockReturnValueOnce(runInsQ).mockReturnValueOnce(updQ)
    await resolveAndPersist('hub-cs', SRC, {
      types: [{ label: '진짜 신규', app: 'soe', count: 1, rows: [], existingMatchId: '다른-허브-유형-id' }],
    }, '2026-06-24T00:00:00Z')
    expect(insTypeQ.insert).toHaveBeenCalledWith(expect.objectContaining({ label: '진짜 신규' }))
  })
})

// 매칭이 id로 맞았는지 라벨로 맞았는지 기록하지 않으면, 릴리스마다 "LLM이 id를 제대로
// 돌려주고 있나"를 데이터로 확인할 수 없다(신규 유형이 안 생겼다는 사실만으로는
// id 경로와 라벨 경로를 구분하지 못한다).
describe('resolveAndPersist — 매칭 경로 기록', () => {
  const EXISTING = { id: 't1', label: '타임아웃', total_count: 0, hub_id: 'hub-cs', source_id: SRC }

  function wire(existing = [EXISTING]) {
    const listQ = mockQuery({ data: existing, error: null })
    const insTypeQ = mockQuery({ data: { id: 'NEW', label: 'n', total_count: 0 }, error: null })
    const runInsQ = mockQuery({ data: { id: 7 }, error: null })
    const updQ = mockQuery({ error: null })
    if (existing.length) mockFrom.mockReturnValueOnce(listQ).mockReturnValueOnce(noRunsToday()).mockReturnValueOnce(runInsQ).mockReturnValueOnce(updQ)
    else mockFrom.mockReturnValueOnce(listQ).mockReturnValueOnce(insTypeQ).mockReturnValueOnce(runInsQ).mockReturnValueOnce(updQ)
    return { runInsQ }
  }

  const persist = (type) => resolveAndPersist('hub-cs', SRC, { types: [type] }, '2026-09-16T00:00:00Z')

  it('id로 맞으면 matched_by=id', async () => {
    const { runInsQ } = wire()
    await persist({ label: '다른 이름', app: 'soe', count: 1, rows: [], existingMatchId: 't1' })
    expect(runInsQ.insert).toHaveBeenCalledWith(expect.objectContaining({ matched_by: 'id' }))
  })

  it('라벨로 맞으면 matched_by=label', async () => {
    const { runInsQ } = wire()
    await persist({ label: '타임아웃', app: 'soe', count: 1, rows: [] })
    expect(runInsQ.insert).toHaveBeenCalledWith(expect.objectContaining({ matched_by: 'label' }))
  })

  it('공백만 다른 라벨로 맞으면 matched_by=loose', async () => {
    const { runInsQ } = wire()
    await persist({ label: ' 타임아웃  ', app: 'soe', count: 1, rows: [] })
    expect(runInsQ.insert).toHaveBeenCalledWith(expect.objectContaining({ matched_by: 'loose' }))
  })

  it('새로 만들면 matched_by=new', async () => {
    const { runInsQ } = wire([])
    await persist({ label: '완전 신규', app: 'soe', count: 1, rows: [] })
    expect(runInsQ.insert).toHaveBeenCalledWith(expect.objectContaining({ matched_by: 'new' }))
  })
})

// 하루 한 번인 분석이 실패하면 다음 tick에 재시도된다. 그런데 적재는 가드(last_analysis_date)를
// 세우기 **전에** 끝나므로, 적재 뒤에 무엇이든 실패하면 다음 tick이 **이미 들어간 회차를 또 넣었다.**
// 프로덕션에서 09/12에 같은 오류 2건이 회차 행 4개로(11·12·19·20시) 들어간 것을 확인했다.
// 회차 행은 LLM 프롬프트의 추세 데이터가 되므로, 없던 급증이 분석 근거가 된다.
describe('resolveAndPersist — 같은 날 재적재(멱등)', () => {
  // resolveAndPersist는 type 객체의 total_count를 제자리에서 갱신한다 — 공유하면 다음 테스트로 샌다.
  const TYPE = () => ({ id: 't1', label: 'A', total_count: 10, hub_id: 'hub-cs', source_id: SRC })
  // 2026-06-24T00:00:00Z = KST 2026-06-24 09:00
  const RUN_AT = '2026-06-24T00:00:00Z'
  const KST_DATE = '2026-06-24'

  it('같은 (유형, app, KST 날짜) 회차가 있으면 새로 넣지 않고 그 행을 갱신한다', async () => {
    const listQ = mockQuery({ data: [TYPE()], error: null })
    const todayQ = mockQuery({ data: [{ id: 55, type_id: 't1', app: 'soe', count: 2 }], error: null })
    const runUpdQ = mockQuery({ data: [{ id: 55 }], error: null })
    const entDelQ = mockQuery({ error: null })
    const updQ = mockQuery({ error: null })
    mockFrom.mockReturnValueOnce(listQ).mockReturnValueOnce(todayQ)
      .mockReturnValueOnce(runUpdQ).mockReturnValueOnce(entDelQ).mockReturnValueOnce(updQ)

    await resolveAndPersist('hub-cs', SRC, {
      types: [{ label: 'A', app: 'soe', count: 5, rows: [], existingMatchId: 't1' }],
    }, RUN_AT)

    expect(todayQ.eq).toHaveBeenCalledWith('run_date', KST_DATE)
    expect(runUpdQ.insert).not.toHaveBeenCalled()
    expect(runUpdQ.update).toHaveBeenCalledWith(expect.objectContaining({ count: 5, run_at: RUN_AT }))
    expect(runUpdQ.eq).toHaveBeenCalledWith('id', 55)
  })

  it('재적재 시 total_count는 **차이만** 반영한다 — 같은 오류를 두 번 더하지 않는다', async () => {
    const listQ = mockQuery({ data: [TYPE()], error: null })
    const todayQ = mockQuery({ data: [{ id: 55, type_id: 't1', app: 'soe', count: 2 }], error: null })
    mockFrom.mockReturnValueOnce(listQ).mockReturnValueOnce(todayQ)
      .mockReturnValueOnce(mockQuery({ data: [{ id: 55 }], error: null }))
      .mockReturnValueOnce(mockQuery({ error: null })) // entries 교체용 delete
    const updQ = mockQuery({ error: null })
    mockFrom.mockReturnValueOnce(updQ)

    await resolveAndPersist('hub-cs', SRC, {
      types: [{ label: 'A', app: 'soe', count: 5, rows: [], existingMatchId: 't1' }],
    }, RUN_AT)

    // 10 - 2(이미 반영된 옛 회차) + 5 = 13. 그냥 더하면 15가 된다.
    expect(updQ.update).toHaveBeenCalledWith(expect.objectContaining({ total_count: 13 }))
  })

  it('재적재 시 그 회차의 기존 entries를 지우고 새로 넣는다', async () => {
    const listQ = mockQuery({ data: [TYPE()], error: null })
    const todayQ = mockQuery({ data: [{ id: 55, type_id: 't1', app: 'soe', count: 1 }], error: null })
    const runUpdQ = mockQuery({ data: [{ id: 55 }], error: null })
    const entDelQ = mockQuery({ error: null })
    const entInsQ = mockQuery({ error: null })
    const updQ = mockQuery({ error: null })
    mockFrom.mockReturnValueOnce(listQ).mockReturnValueOnce(todayQ)
      .mockReturnValueOnce(runUpdQ).mockReturnValueOnce(entDelQ)
      .mockReturnValueOnce(entInsQ).mockReturnValueOnce(updQ)

    const logs = [{ app: 'soe', count: 1, error: null, rows: [{ ts: 'T0', msg: 'm0' }] }]
    await resolveAndPersist('hub-cs', SRC, {
      types: [{ label: 'A', app: 'soe', count: 1, rows: [0], existingMatchId: 't1' }],
    }, RUN_AT, logs)

    expect(entDelQ.delete).toHaveBeenCalled()
    expect(entDelQ.eq).toHaveBeenCalledWith('run_id', 55)
    expect(entInsQ.insert).toHaveBeenCalledWith([
      { type_id: 't1', run_id: 55, app: 'soe', occurred_at: 'T0', msg: 'm0' },
    ])
  })

  it('app이 다르면 같은 날이어도 별개 회차다', async () => {
    const listQ = mockQuery({ data: [TYPE()], error: null })
    const todayQ = mockQuery({ data: [{ id: 55, type_id: 't1', app: 'webhook', count: 2 }], error: null })
    const runInsQ = mockQuery({ data: { id: 56 }, error: null })
    const updQ = mockQuery({ error: null })
    mockFrom.mockReturnValueOnce(listQ).mockReturnValueOnce(todayQ)
      .mockReturnValueOnce(runInsQ).mockReturnValueOnce(updQ)

    await resolveAndPersist('hub-cs', SRC, {
      types: [{ label: 'A', app: 'soe', count: 5, rows: [], existingMatchId: 't1' }],
    }, RUN_AT)

    expect(runInsQ.insert).toHaveBeenCalledWith(expect.objectContaining({ app: 'soe', run_date: KST_DATE }))
    expect(updQ.update).toHaveBeenCalledWith(expect.objectContaining({ total_count: 15 }))
  })

  it('신규 회차에는 run_date(KST)를 함께 적는다', async () => {
    const listQ = mockQuery({ data: [TYPE()], error: null })
    const todayQ = mockQuery({ data: [], error: null })
    const runInsQ = mockQuery({ data: { id: 60 }, error: null })
    const updQ = mockQuery({ error: null })
    mockFrom.mockReturnValueOnce(listQ).mockReturnValueOnce(todayQ)
      .mockReturnValueOnce(runInsQ).mockReturnValueOnce(updQ)

    // UTC 2026-06-23T15:00Z = KST 2026-06-24 00:00 — 날짜 경계가 UTC가 아니라 KST임을 본다.
    await resolveAndPersist('hub-cs', SRC, {
      types: [{ label: 'A', app: 'soe', count: 1, rows: [], existingMatchId: 't1' }],
    }, '2026-06-23T15:00:00Z')

    expect(runInsQ.insert).toHaveBeenCalledWith(expect.objectContaining({ run_date: '2026-06-24' }))
  })
})
