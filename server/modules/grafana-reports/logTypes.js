// server/modules/grafana-reports/logTypes.js
// 영속 로그 유형 + 회차별 집계 + 개별 로그(entries) 조회/편집.
// 테이블(grafana_log_types/grafana_log_type_runs/grafana_log_entries)은 hub_id + source_id로 격리.
// 유형은 (hub_id, source_id) 스코프 — 한 허브가 여러 환경(소스)을 보므로 환경별로 오류가 분리된다.
import { repos } from '../../data/index.js'
import { appRowIndex, activeLogGroups } from './analyze.js'


// 라벨 비교용 느슨한 형태 — 앞뒤 공백과 중복 공백만 지운다.
// 대소문자나 문장부호까지 지우면 의도적으로 다른 유형끼리 합쳐질 수 있어 거기까지는 가지 않는다.
const looseLabel = (v) => String(v ?? '').trim().replace(/\s+/g, ' ')

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
function kstDateString(date) {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10)
}

export async function listTypes(hubId, sourceId) {
  return repos.grafana.types.list(hubId, sourceId)
}

// 유형 목록 + 최근 회차 추세(recentRuns). AI 분석 프롬프트용.
export async function listTypesWithHistory(hubId, sourceId, { days = 14, maxPoints = 5 } = {}) {
  const types = await listTypes(hubId, sourceId)
  if (!types.length) return types
  let runs = []
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString()
    const ids = types.map((t) => t.id)
    runs = await repos.grafana.runs.listSince(ids, since)
  } catch {
    return types.map((t) => ({ ...t, recentRuns: [] }))
  }
  const byType = new Map()
  for (const r of runs) {
    const date = kstDateString(new Date(r.run_at))
    let dates = byType.get(r.type_id)
    if (!dates) { dates = new Map(); byType.set(r.type_id, dates) }
    dates.set(date, (dates.get(date) ?? 0) + (r.count ?? 0))
  }
  return types.map((t) => ({
    ...t,
    recentRuns: [...(byType.get(t.id) ?? new Map()).entries()]
      .slice(0, maxPoints)
      .map(([date, count]) => ({ date, count })),
  }))
}

// 유형 + runs + entries. 타 허브/타 소스 소유 유형은 스코프 불일치로 조회되지 않아 null(차단).
export async function getType(hubId, sourceId, id) {
  const type = await repos.grafana.types.get(hubId, sourceId, id)
  if (!type) return null
  const runs = await repos.grafana.runs.listForType(id, 100)
  const entries = await repos.grafana.entries.listForType(id, 1000)
  return { ...type, runs, entries }
}

// 소유 검증(getType) 통과 후에만 갱신. 타 허브/타 소스면 null.
export async function updateType(hubId, sourceId, id, fields) {
  const owned = await getType(hubId, sourceId, id)
  if (!owned) return null
  const allowed = ['note', 'label', 'description']
  const update = { updated_at: new Date().toISOString() }
  for (const k of allowed) if (fields[k] !== undefined) update[k] = fields[k]
  return repos.grafana.types.update(id, update)
}

// 소유 검증(getType) 통과 후에만 삭제. 타 허브/타 소스면 null.
export async function deleteType(hubId, sourceId, id) {
  const owned = await getType(hubId, sourceId, id)
  if (!owned) return null
  await repos.grafana.types.remove(id)
  return true
}

// 회차별 메모 저장. run → type_id → 해당 유형의 (hub_id, source_id)가 요청과 일치하는지 확인 후에만 갱신.
export async function updateRun(hubId, sourceId, runId, note) {
  const run = await repos.grafana.runs.get(runId)
  if (!run) return null
  if (!(await repos.grafana.types.get(hubId, sourceId, run.type_id))) return null
  return repos.grafana.runs.update(runId, { note })
}

// 주어진 유형들의 특정 KST 날짜 회차를 (type_id|app) → 행으로. 유형이 없으면 조회하지 않는다.
async function runsOnDate(typeIds, runDate) {
  const map = new Map()
  if (!typeIds.length) return map
  for (const r of await repos.grafana.runs.listOnDate(typeIds, runDate)) map.set(`${r.type_id}|${r.app || ''}`, r)
  return map
}

// 분석 결과의 types[]를 (hub_id, source_id) 스코프 영속 유형에 반영 + 회차/entries 적재 + 누적 갱신.
// 신규 유형 insert에는 hub_id와 source_id를 반드시 포함(타 허브/타 소스와 격리).
export async function resolveAndPersist(hubId, sourceId, analysis, runAt, logs = []) {
  const rowsByApp = appRowIndex(activeLogGroups(logs))
  const existing = await listTypes(hubId, sourceId)
  const runDate = kstDateString(new Date(runAt))
  // 같은 KST 날짜에 이미 적재된 회차. 분석은 하루 한 번이지만 실패하면 다음 tick에 재시도되고,
  // 가드(last_analysis_date)는 적재가 **끝난 뒤에** 세워진다. 그래서 적재 뒤에 무엇이든 실패하면
  // 다음 tick이 같은 오류를 회차 행으로 다시 넣었다(09/12 프로덕션: 같은 2건이 행 4개).
  // 회차 행은 listTypesWithHistory로 LLM 프롬프트의 추세가 되므로 없던 급증이 분석 근거가 된다.
  // 가드를 선점으로 바꾸지 않는 이유: 발송은 중복이 더 나쁘지만 분석은 일시 실패 시 재시도가
  // 되어야 한다. 재시도를 살리면서 중복만 막으려면 적재 쪽이 멱등해야 한다.
  const todayRuns = await runsOnDate(existing.map((t) => t.id), runDate)
  // 매칭 키 3단. id가 가장 강하다 — 라벨은 운영자가 편집할 수 있고(PATCH /log-types/:id),
  // 후보 문자열은 LLM이 만들어 돌려주는 값이라 둘 중 하나만 어긋나도 같은 오류가 새 유형으로
  // 갈라져 누적·추세가 끊긴다. 스코프 안(hub_id+source_id)에서만 찾으므로, 모르는 id를
  // 주더라도 남의 유형에 붙지 않고 신규로 떨어진다.
  const byId = new Map(existing.map((t) => [t.id, t]))
  const byLabel = new Map(existing.map((t) => [t.label, t]))
  const byLooseLabel = new Map(existing.map((t) => [looseLabel(t.label), t]))

  for (const at of analysis?.types ?? []) {
    // 어느 키로 맞았는지 남긴다. 신규 유형이 안 생겼다는 사실만으로는 id 경로와 라벨 경로를
    // 구분할 수 없어, "LLM이 id를 제대로 돌려주고 있나"를 데이터로 확인할 방법이 없었다.
    let matchedBy = 'id'
    let type = at.existingMatchId ? byId.get(at.existingMatchId) : null
    if (!type) {
      matchedBy = 'label'
      type = (at.existingMatch && byLabel.get(at.existingMatch)) || byLabel.get(at.label)
    }
    if (!type) {
      matchedBy = 'loose'
      type = byLooseLabel.get(looseLabel(at.label))
    }
    if (!type) {
      matchedBy = 'new'
      type = await repos.grafana.types.insert({ hub_id: hubId, source_id: sourceId, label: at.label, description: at.description || null, ai_note: at.aiNote || null })
      byLabel.set(type.label, type)
    }

    // 오늘 이 (유형, app) 회차가 이미 있으면 새 행을 만들지 않고 그 행을 덮어쓴다.
    // 나중 분석이 더 긴 창을 본 결과이므로 최신 값이 옳다.
    const runKey = `${type.id}|${at.app || ''}`
    const prior = todayRuns.get(runKey)
    let runId
    if (prior) {
      await repos.grafana.runs.update(prior.id, { run_at: runAt, count: at.count ?? 0, matched_by: matchedBy })
      runId = prior.id
      // 옛 entries는 갱신이 아니라 교체다 — 남겨 두면 지워진 로그가 계속 보인다.
      await repos.grafana.entries.removeForRun(runId)
    } else {
      const run = await repos.grafana.runs.insert({
        type_id: type.id, run_at: runAt, run_date: runDate, app: at.app || null, count: at.count ?? 0,
        matched_by: matchedBy,
      })
      runId = run.id
      todayRuns.set(runKey, { id: runId, count: at.count ?? 0 })
    }

    const appRows = rowsByApp.get(at.app) ?? []
    const entries = (at.rows ?? [])
      .filter((i) => i < appRows.length)
      .map((i) => appRows[i])
      .map((r) => ({ type_id: type.id, run_id: runId, app: at.app || null, occurred_at: r.ts || null, msg: r.msg }))
    await repos.grafana.entries.insertMany(entries)

    // label은 갱신하지 않는다 — 운영자가 고친 이름을 AI 제안이 덮어쓰면 안 된다.
    // 재적재면 이미 누적에 들어가 있는 옛 회차분을 빼고 새 값을 넣는다 — 그냥 더하면 같은
    // 오류가 두 번 세어진다. (프로덕션에서 total_count가 회차 합계와 6개 유형에서 어긋나 있었다.)
    const nextTotal = (type.total_count ?? 0) - (prior?.count ?? 0) + (at.count ?? 0)
    await repos.grafana.types.update(type.id, {
      total_count: nextTotal,
      last_seen_at: runAt,
      description: at.description || type.description || null,
      ...(at.aiNote ? { ai_note: at.aiNote } : {}),
      updated_at: new Date().toISOString(),
    })
    type.total_count = nextTotal
  }
}
