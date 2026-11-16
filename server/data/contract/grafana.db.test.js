// 저장소 계약 — Grafana(설정 · 소스 · 로그 유형 · 실행 · 엔트리). 두 구현이 같은 결과를 낸다.
import { it, expect } from 'vitest'
import { contractSuite } from './harness.js'

const NO_ID = '00000000-0000-4000-8000-000000000000'

contractSuite('grafana', ({ repos, sql }) => {
  const g = () => repos().grafana
  const hub = async (key) => (await sql('insert into hubs (key, name) values ($1, $1) returning id', [key]))[0].id

  it('settings: getRow(없으면 null) → createRow(기본값) → update · listActivity', async () => {
    const h = await hub('ops')
    expect(await g().settings.getRow(h)).toBeNull()
    const row = await g().settings.createRow(h)
    expect(row).toMatchObject({ hub_id: h, recipients: [], send_hour: 9, metrics: [] })
    const up = await g().settings.update(h, { recipients: ['a@x'], last_analysis: { ok: 1 }, last_analysis_date: '2026-11-09', updated_at: '2026-11-09T00:00:00.000Z' })
    expect(up).toMatchObject({ recipients: ['a@x'], last_analysis: { ok: 1 }, last_analysis_date: '2026-11-09' })
    expect((await g().settings.listActivity())[0]).toEqual({ hub_id: h, last_analysis: { ok: 1 }, last_analysis_date: '2026-11-09', last_sent_date: null })
  })

  it('sources: create → list(sort_order) · get · first · update · count · remove(허브 범위)', async () => {
    const h = await hub('ops')
    const other = await hub('cs')
    const b = await g().sources.create(h, { name: 'B', sort_order: 2, recipients: ['x@y'], metrics: [{ q: 1 }] })
    const a = await g().sources.create(h, { name: 'A', sort_order: 1 })
    expect(b).toMatchObject({ hub_id: h, name: 'B', recipients: ['x@y'], metrics: [{ q: 1 }], enabled: false })
    expect((await g().sources.list(h)).map((s) => s.name)).toEqual(['A', 'B'])
    expect((await g().sources.first(h)).name).toBe('A')
    expect(await g().sources.first(other)).toBeNull()
    expect((await g().sources.get(h, b.id)).name).toBe('B')
    expect(await g().sources.get(other, b.id)).toBeNull()
    expect((await g().sources.update(h, a.id, { token: 't', last_analysis: { x: 1 } })).last_analysis).toEqual({ x: 1 })
    expect(await g().sources.update(other, a.id, { token: 'x' })).toBeNull()
    expect(await g().sources.count(h)).toBe(2)
    expect(await g().sources.remove(other, a.id)).toBe(false)
    expect(await g().sources.remove(h, a.id)).toBe(true)
  })

  it('types: insert → list(last_seen_at desc nulls last) · get(허브·소스 범위) · update · remove', async () => {
    const h = await hub('ops')
    const src = await g().sources.create(h, { name: 'S' })
    const t1 = await g().types.insert({ hub_id: h, source_id: src.id, label: 'old', description: null, ai_note: null })
    const t2 = await g().types.insert({ hub_id: h, source_id: src.id, label: 'never', description: null, ai_note: null })
    const t3 = await g().types.insert({ hub_id: h, source_id: src.id, label: 'new', description: 'd', ai_note: 'n' })
    await g().types.update(t1.id, { last_seen_at: '2026-11-01T00:00:00.000Z' })
    await g().types.update(t3.id, { last_seen_at: '2026-11-09T00:00:00.000Z', total_count: 5 })
    expect((await g().types.list(h, src.id)).map((t) => t.label)).toEqual(['new', 'old', 'never'])
    expect((await g().types.get(h, src.id, t3.id)).total_count).toBe(5)
    expect(await g().types.get(h, NO_ID, t3.id)).toBeNull()
    expect(await g().types.update(NO_ID, { note: 'x' })).toBeNull()
    await g().types.remove(t2.id)
    expect((await g().types.list(h, src.id))).toHaveLength(2)
  })

  it('runs·entries: insert → listForType · listSince · listOnDate · get · update · entries(nulls last) · removeForRun', async () => {
    const h = await hub('ops')
    const src = await g().sources.create(h, { name: 'S' })
    const t = await g().types.insert({ hub_id: h, source_id: src.id, label: 'L', description: null, ai_note: null })
    const r1 = await g().runs.insert({ type_id: t.id, run_at: '2026-11-08T00:00:00.000Z', run_date: '2026-11-08', app: 'a', count: 2, matched_by: 'new' })
    const r2 = await g().runs.insert({ type_id: t.id, run_at: '2026-11-09T00:00:00.000Z', run_date: '2026-11-09', app: null, count: 3, matched_by: 'id' })
    expect(typeof r1.id).toBe('number')
    expect((await g().runs.listForType(t.id, 100)).map((r) => r.id)).toEqual([r2.id, r1.id])
    expect((await g().runs.listSince([t.id], '2026-11-08T12:00:00.000Z'))).toEqual([{ type_id: t.id, run_at: expect.any(String), count: 3 }])
    expect((await g().runs.listOnDate([t.id], '2026-11-08'))).toEqual([{ id: r1.id, type_id: t.id, app: 'a', count: 2 }])
    expect(await g().runs.listOnDate([], '2026-11-08')).toEqual([])
    expect((await g().runs.get(r1.id)).count).toBe(2)
    expect(await g().runs.get(999999)).toBeNull()
    expect((await g().runs.update(r1.id, { note: 'n' })).note).toBe('n')
    await g().entries.insertMany([
      { type_id: t.id, run_id: r1.id, app: 'a', occurred_at: null, msg: 'm0' },
      { type_id: t.id, run_id: r1.id, app: 'a', occurred_at: '2026-11-08T01:00:00.000Z', msg: 'm1' },
      { type_id: t.id, run_id: r2.id, app: null, occurred_at: '2026-11-09T01:00:00.000Z', msg: 'm2' },
    ])
    await g().entries.insertMany([])
    expect((await g().entries.listForType(t.id, 1000)).map((e) => e.msg)).toEqual(['m2', 'm1', 'm0'])
    await g().entries.removeForRun(r1.id)
    expect((await g().entries.listForType(t.id, 1000)).map((e) => e.msg)).toEqual(['m2'])
  })
})
