// 저장소 계약 — 챗봇(hub_chatbots · hub_chatbot_settings · hub_chatbot_check_log). 두 구현이 같은 결과를 낸다.
import { it, expect } from 'vitest'
import { contractSuite } from './harness.js'

const NO_ID = '00000000-0000-4000-8000-000000000000'
const BOT = { name: 'B', url: 'https://x', scenario: [{ send: 'hi' }], input_selector: null, category: null }

contractSuite('chatbots', ({ repos, sql }) => {
  const c = () => repos().chatbots
  const hub = async (key) => (await sql('insert into hubs (key, name) values ($1, $1) returning id', [key]))[0].id

  it('createBot → listBots(sort_order·created_at asc) · 요약·이름 목록', async () => {
    const h = await hub('ops')
    const a = await c().createBot(h, { ...BOT, name: 'A' })
    await c().createBot(h, { ...BOT, name: 'B2' })
    expect(a).toMatchObject({ hub_id: h, name: 'A', scenario: [{ send: 'hi' }], enabled: true })
    expect((await c().listBots(h)).map((b) => b.name)).toEqual(['A', 'B2'])
    expect(Object.keys((await c().listBotSummaries(h))[0]).sort()).toEqual(['category', 'enabled', 'id', 'name'])
    expect(Object.keys((await c().listAllBotNames())[0]).sort()).toEqual(['hub_id', 'id', 'name'])
  })

  it('listEnabledBots: 꺼진 봇 제외 · botId · category · __none__(미분류)', async () => {
    const h = await hub('ops')
    const a = await c().createBot(h, { ...BOT, name: 'A', category: '카드' })
    await c().createBot(h, { ...BOT, name: 'N' })
    const off = await c().createBot(h, { ...BOT, name: 'Off', category: '카드' })
    await c().updateBot(h, off.id, { enabled: false })
    expect((await c().listEnabledBots(h, {})).map((b) => b.name).sort()).toEqual(['A', 'N'])
    expect((await c().listEnabledBots(h, { botId: a.id })).map((b) => b.name)).toEqual(['A'])
    expect((await c().listEnabledBots(h, { category: '카드' })).map((b) => b.name)).toEqual(['A'])
    expect((await c().listEnabledBots(h, { category: '__none__' })).map((b) => b.name)).toEqual(['N'])
  })

  it('updateBot · deleteBot은 허브 범위 안에서만', async () => {
    const h = await hub('ops')
    const other = await hub('cs')
    const a = await c().createBot(h, BOT)
    expect((await c().updateBot(h, a.id, { name: 'X', scenario: [] })).scenario).toEqual([])
    expect(await c().updateBot(other, a.id, { name: 'Y' })).toBeNull()
    expect(await c().deleteBot(other, a.id)).toBe(false)
    expect(await c().deleteBot(h, a.id)).toBe(true)
  })

  it('renameCategory: from → to, to=null이면 미분류', async () => {
    const h = await hub('ops')
    await c().createBot(h, { ...BOT, name: 'A', category: '카드' })
    await c().renameCategory(h, '카드', '금융')
    expect((await c().listBots(h))[0].category).toBe('금융')
    await c().renameCategory(h, '금융', null)
    expect((await c().listBots(h))[0].category).toBeNull()
  })

  it('settings: ensureSettings(두 번 해도 하나) → getSettings · updateSettings(updated_at 채움) · 없으면 null', async () => {
    const h = await hub('ops')
    expect(await c().getSettings(h)).toBeNull()
    await c().ensureSettings(h)
    await c().ensureSettings(h)
    expect(await c().getSettings(h)).toMatchObject({ hub_id: h, recipients: [], categories: [] })
    const before = (await c().getSettings(h)).updated_at
    await new Promise((r) => setTimeout(r, 5))
    const s = await c().updateSettings(h, { recipients: ['a@x'], categories: ['카드'] })
    expect(s).toMatchObject({ recipients: ['a@x'], categories: ['카드'] })
    expect(s.updated_at).not.toBe(before)
    expect(await c().updateSettings(NO_ID, { recipients: [] })).toBeNull()
  })
})

contractSuite('checks', ({ repos, sql }) => {
  it('insert → listRecent(checked_at desc, limit, cols) · listRecentEvents', async () => {
    const h = (await sql("insert into hubs (key, name) values ('ops', 'Ops') returning id"))[0].id
    const bot = await repos().chatbots.createBot(h, BOT)
    await repos().checks.insert({ chatbot_id: bot.id, hub_id: h, ok: true, detail: null, duration_ms: 10, attempts: 1 })
    await sql("update hub_chatbot_check_log set checked_at = now() - interval '1 hour'")
    await repos().checks.insert({ chatbot_id: bot.id, hub_id: h, ok: false, detail: 'boom', duration_ms: 20, attempts: 1 })
    const recent = await repos().checks.listRecent([bot.id], 10)
    expect(recent.map((r) => r.ok)).toEqual([false, true])
    expect(Object.keys(recent[0]).sort()).toEqual(['chatbot_id', 'checked_at', 'detail', 'duration_ms', 'ok'])
    expect(Object.keys((await repos().checks.listRecent([bot.id], 1, ['chatbot_id', 'ok', 'checked_at']))[0]).sort()).toEqual(['chatbot_id', 'checked_at', 'ok'])
    expect((await repos().checks.listRecentEvents(1))[0]).toMatchObject({ chatbot_id: bot.id, hub_id: h, ok: false, detail: 'boom' })
    expect(await repos().checks.listRecent([], 10)).toEqual([])
  })

  it('listRecent: 허용 밖 컬럼은 throw', async () => {
    await expect(repos().checks.listRecent(['x'], 1, ['id; drop table hubs'])).rejects.toThrow(/cols/)
  })
})
