// server/lib/hubCallLimit.js — 허브 단위 호출 상한.
//
// 지키는 대상은 서버 부하가 아니라 **외부 청구**다. LLM 같은 외부 API를 부르는 모듈은
// 호출마다 다른 계정에 비용이 청구된다. 허브가 공개면
// URL을 아는 누구나 그 청구를 만들 수 있으므로, 비밀번호와 별개로 총량 천장을 둔다.
//
// 카운터를 DB에 두는 이유: Vercel 서버리스에서 인메모리 카운터는 인스턴스마다 따로 놀고
// 콜드스타트마다 리셋된다 — 동시에 때리면 사실상 무제한이라 방어가 되지 않는다.
// insert는 원자적이고 count는 인덱스 조회라, 수 초짜리 상류 호출 앞에서 무시할 비용이다.
//
// 부수 효과로 사용량 가시성이 생긴다(그동안 호출 기록이 전혀 없었다).
import { repos } from '../data/index.js'

export const CALLS_TABLE = 'hub_module_calls'

/**
 * 최근 windowMs 안의 해당 허브·기능 호출이 limit 미만일 때만 통과시키는 미들웨어.
 * requireHubFeature 뒤에 놓는다 — req.hub(해석된 허브)를 쓴다.
 *
 * @param {string} featureKey
 * @param {{limit?: number|(() => number), windowMs?: number}} [opts]
 *   limit을 함수로 주면 **요청마다** 다시 읽는다 — env로 조정하는 값을 모듈 로드 시점에
 *   고정하지 않기 위해서다.
 */
export function limitHubCalls(featureKey, { limit = 30, windowMs = 60 * 60 * 1000 } = {}) {
  return async function hubCallLimit(req, res, next) {
    const hubId = req.hub?.id
    // 미들웨어 순서가 잘못 잡힌 경우다. 통과시키면 상한이 조용히 사라지므로 막는다.
    if (!hubId) return res.status(500).json({ error: 'hub가 해석되지 않았습니다' })

    const max = typeof limit === 'function' ? limit() : limit
    const windowStart = new Date(Date.now() - windowMs).toISOString()

    let count
    try {
      count = await repos.calls.count(hubId, featureKey, windowStart)
    } catch (countError) {
      // 셀 수 없으면 닫는다 — 열어두면 "DB를 흔들면 상한이 사라지는" 우회로가 된다.
      console.error(`[${featureKey}] 호출 상한 조회 실패:`, countError)
      return res.status(503).json({ error: '일시적으로 요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.' })
    }

    if ((count ?? 0) >= max) {
      return res.status(429).json({
        error: `이 허브의 시간당 호출 한도(${max}회)를 초과했습니다. 잠시 후 다시 시도해 주세요.`,
        limit: max,
        windowMinutes: Math.round(windowMs / 60000),
      })
    }

    // 세지 못하는 호출은 보내지 않는다 — 기록 실패를 통과시키면 그 순간부터 상한이 무의미하다.
    // 기록은 hub_id·feature_key뿐이다(호출자 IP·문서 본문은 남기지 않는다).
    try {
      await repos.calls.record(hubId, featureKey)
    } catch (insertError) {
      console.error(`[${featureKey}] 호출 기록 실패:`, insertError)
      return res.status(503).json({ error: '일시적으로 요청을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.' })
    }

    return next()
  }
}
