// chatbot-monitoring 서버 모듈 — 계약: { key, apiRouter, overview }
import router from './router.js'
import { repos } from '../../data/index.js'

// 백오피스용 허브별 요약: 봇 수 + 실패 수 + 봇별 최근 체크
async function overview(hubId) {
  // 조회 실패는 빈 요약으로 보여 준다(이전 동작).
  const bots = await repos.chatbots.listBotSummaries(hubId).catch(() => [])
  const ids = bots.map(b => b.id)
  const last = new Map()
  if (ids.length) {
    const logs = await repos.checks.listRecent(ids, Math.min(ids.length * 3, 600), ['chatbot_id', 'ok', 'checked_at']).catch(() => [])
    for (const r of logs) if (!last.has(r.chatbot_id)) last.set(r.chatbot_id, { ok: r.ok, checked_at: r.checked_at })
  }
  const items = bots.map(b => ({ ...b, last_check: last.get(b.id) ?? null }))
  return {
    summary: { bot_count: items.length, failing_count: items.filter(i => i.last_check && !i.last_check.ok).length },
    items,
  }
}

export default { key: 'chatbot-monitoring', apiRouter: router, overview }
