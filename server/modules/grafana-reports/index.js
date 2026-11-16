// grafana-reports 서버 모듈 — 계약: { key, apiRouter, overview }
import router from './router.js'
import { listSources } from './sources.js'

// 백오피스용 허브 요약: 소스(환경)들을 집계 — 하나라도 활성이면 enabled,
// 최신 분석일, 소스별 최신 분석 불릿 수 합계(알림 근사).
async function overview(hubId) {
  let sources = []
  try { sources = await listSources(hubId) } catch { /* 조회 실패 시 빈 요약 */ }
  const dates = sources.map((s) => s.last_analysis_date).filter(Boolean).sort()
  const last_alert_count = sources.reduce(
    (n, s) => n + String(s.last_analysis?.summary ?? '').split('\n').filter((l) => l.trim()).length,
    0,
  )
  return {
    summary: {
      enabled: sources.some((s) => s.enabled),
      last_analysis_date: dates.length ? dates[dates.length - 1] : null,
      last_alert_count,
    },
    items: [],
  }
}

export default { key: 'grafana-reports', apiRouter: router, overview }
