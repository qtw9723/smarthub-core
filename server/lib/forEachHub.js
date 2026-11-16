// 모든 허브 순회 — 사내 정시 작업(k8s CronJob)이 `?hub=*`로 부를 때. 허브가 늘어도 CronJob을 추가하지 않게,
// 켜진 허브 중 그 기능이 켜진 허브만 돈다. 허브마다 격리해 한 허브 실패가 다른 허브를 막지 않는다.
import { repos } from '../data/index.js'

/** @returns {Promise<{ hub: string, ok: boolean, result?: any, error?: string }[]>} */
export async function forEachHub(featureKey, fn) {
  const out = []
  for (const hub of await repos.hubs.listHubs()) {
    if (!hub.enabled) continue
    let feature
    try {
      feature = await repos.features.getFeature(hub.id, featureKey)
    } catch (e) {
      // 조회 실패는 '꺼짐'과 구분해 결과에 남긴다 — DB 장애가 조용히 사라지지 않게.
      out.push({ hub: hub.key, ok: false, error: `기능 조회 실패: ${e?.message ?? e}` })
      continue
    }
    if (!feature?.enabled) continue
    try {
      out.push({ hub: hub.key, ok: true, result: await fn({ id: hub.id, key: hub.key }) })
    } catch (e) {
      out.push({ hub: hub.key, ok: false, error: String(e?.message ?? e) })
    }
  }
  return out
}

/** `?hub=*`(기능이 켜진 모든 허브)인가. 생략·특정 허브는 지금처럼 그 허브(기본 허브) 하나다. */
export const isAllHubs = (req) => req.query.hub === '*'
