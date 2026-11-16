// 저장소 계약 — 허브·기능·보안 레벨·호출 기록. 두 구현이 같은 결과를 낸다.
import { it, expect } from 'vitest'
import { contractSuite } from './harness.js'
import { UniqueViolationError } from '../errors.js'

const NO_ID = '00000000-0000-4000-8000-000000000000'

contractSuite('hubs', ({ repos, sql }) => {
  const r = () => repos().hubs

  it('createHub → getHubByKey · getHubId · getHubByIdOrKey(UUID·key)', async () => {
    const h = await r().createHub({ key: 'ops', name: 'Ops' })
    expect(h).toMatchObject({ key: 'ops', name: 'Ops', enabled: true, password_hash: null })
    expect((await r().getHubByKey('ops')).id).toBe(h.id)
    expect(await r().getHubId('ops')).toBe(h.id)
    expect((await r().getHubByIdOrKey(h.id)).key).toBe('ops')
    expect((await r().getHubByIdOrKey('ops')).id).toBe(h.id)
  })

  it('없는 허브는 null', async () => {
    expect(await r().getHubByKey('nope')).toBeNull()
    expect(await r().getHubId('nope')).toBeNull()
    expect(await r().getHubByIdOrKey(NO_ID)).toBeNull()
  })

  it('같은 key는 UniqueViolationError', async () => {
    await r().createHub({ key: 'ops', name: 'Ops' })
    await expect(r().createHub({ key: 'ops', name: 'Ops2' })).rejects.toBeInstanceOf(UniqueViolationError)
  })

  it('listHubs는 sort_order·created_at 순, listHubIdNames는 id·key·name만', async () => {
    await sql("insert into hubs (key, name, sort_order, created_at) values ('b', 'B', 2, now()), ('a', 'A', 1, now() + interval '1 s'), ('c', 'C', 1, now())")
    expect((await r().listHubs()).map((h) => h.key)).toEqual(['c', 'a', 'b'])
    const names = await r().listHubIdNames()
    expect(Object.keys(names[0]).sort()).toEqual(['id', 'key', 'name'])
  })

  it('updateHub · setPasswordHash · setSecurityAck는 바뀐 행, 없는 id면 null', async () => {
    const h = await r().createHub({ key: 'ops', name: 'Ops' })
    expect((await r().updateHub(h.id, { name: 'Ops2', enabled: false })).name).toBe('Ops2')
    expect((await r().setPasswordHash(h.id, 'hash')).password_hash).toBe('hash')
    expect((await r().setSecurityAck(h.id, 'L2')).security_ack_level).toBe('L2')
    expect(await r().updateHub(NO_ID, { name: 'x' })).toBeNull()
    expect(await r().setPasswordHash(NO_ID, null)).toBeNull()
  })

  it('updateHub: 허용 밖 키는 throw', async () => {
    const h = await r().createHub({ key: 'ops', name: 'Ops' })
    await expect(r().updateHub(h.id, { key: 'x' })).rejects.toThrow(/updateHub/)
  })

  it('deleteHub는 지웠으면 true', async () => {
    const h = await r().createHub({ key: 'ops', name: 'Ops' })
    expect(await r().deleteHub(h.id)).toBe(true)
    expect(await r().deleteHub(h.id)).toBe(false)
  })
})

contractSuite('features', ({ repos, sql }) => {
  const hub = async (key) => (await sql('insert into hubs (key, name) values ($1, $1) returning id', [key]))[0].id

  it('upsert(새로·갱신) → getFeature · listPublic · listAdmin · listAllFlags', async () => {
    const h = await hub('ops')
    await repos().features.upsert(h, 'module-b', { enabled: true, sort_order: 2 })
    await repos().features.upsert(h, 'module-a', { enabled: false, config: { a: 1 }, sort_order: 1 })
    const updated = await repos().features.upsert(h, 'module-a', { enabled: true })
    expect(updated).toMatchObject({ hub_id: h, feature_key: 'module-a', enabled: true, config: { a: 1 }, sort_order: 1 })
    expect(await repos().features.getFeature(h, 'module-b')).toEqual({ enabled: true })
    expect(await repos().features.getFeature(h, 'nope')).toBeNull()
    expect(await repos().features.listPublic(h)).toEqual([
      { feature_key: 'module-a', enabled: true, sort_order: 1 },
      { feature_key: 'module-b', enabled: true, sort_order: 2 },
    ])
    expect((await repos().features.listAdmin(h))[0]).toEqual({ feature_key: 'module-a', enabled: true, config: { a: 1 }, sort_order: 1 })
    expect((await repos().features.listAllFlags()).length).toBe(2)
  })
})

contractSuite('security', ({ repos }) => {
  it('upsert(새로·갱신) → list · remove', async () => {
    const t = '2026-11-09T00:00:00.000Z'
    await repos().security.upsert({ module_key: 'module-b', level: 'L1', reason: '사내만', updated_at: t })
    await repos().security.upsert({ module_key: 'module-b', level: 'L2', reason: null, updated_at: t })
    const rows = await repos().security.list()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ module_key: 'module-b', level: 'L2', reason: null })
    await repos().security.remove('module-b')
    expect(await repos().security.list()).toEqual([])
  })
})

contractSuite('calls', ({ repos, sql }) => {
  it('record → count(창 안만 센다)', async () => {
    const h = (await sql("insert into hubs (key, name) values ('ops', 'Ops') returning id"))[0].id
    await repos().calls.record(h, 'module-a')
    await repos().calls.record(h, 'module-a')
    await repos().calls.record(h, 'module-a')
    await sql("insert into hub_module_calls (hub_id, feature_key, called_at) values ($1, 'module-a', now() - interval '2 hours')", [h])
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    expect(await repos().calls.count(h, 'module-a', since)).toBe(2)
  })
})

contractSuite('authFailures', ({ repos, sql }) => {
  it('record → count(scope·client·창 안만) → prune(오래된 것만)', async () => {
    await repos().authFailures.record('login', 'c1')
    await repos().authFailures.record('login', 'c1')
    await repos().authFailures.record('login', 'c2')
    await repos().authFailures.record('other', 'c1')
    await sql("insert into auth_failures (scope, client, failed_at) values ('login', 'c1', now() - interval '2 days')")
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    expect(await repos().authFailures.count('login', 'c1', since)).toBe(2)
    await repos().authFailures.prune(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    expect((await sql('select count(*)::int as n from auth_failures'))[0].n).toBe(4)
  })
})

