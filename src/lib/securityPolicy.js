// src/lib/securityPolicy.js — 백오피스의 보안 정책 판정(예전 costRisk.js의 일반화).
//
// 허브의 요구 레벨 = 켜진 모듈들의 실효 레벨 중 최댓값. 요구 레벨이 비밀번호를 요구(L2+)하는데
// 허브에 비밀번호가 없으면 정책 위반이다. 막지 않고 알린다(팝업·상시 경고·행동 직전 확인).
//
// 실효 레벨은 서버(GET /api/admin/security)에서 오므로 판정 함수는 {moduleKey: level} 맵을 인자로
// 받는다. 맵을 받기 전이나 실패했을 때는 코드 기본값 맵으로 판정한다 — 경고가 사라지지 않게.
import { getModules } from '../modules/index.js'
import {
  LEVELS, LEVEL_INFO, MODULE_SECURITY_DEFAULTS, levelRank, needsPassword, defaultLevelOf,
} from '../../shared/securityPolicy.js'

export {
  LEVELS, LEVEL_INFO, MODULE_SECURITY_DEFAULTS, UNKNOWN_MODULE_LEVEL, levelRank, needsPassword, defaultLevelOf,
} from '../../shared/securityPolicy.js'

/** 클라 레지스트리 전 모듈의 기본 레벨 맵. */
export function defaultLevelMap() {
  return Object.fromEntries(getModules().map(m => [m.key, defaultLevelOf(m.key)]))
}

/** GET /api/admin/security의 modules 배열 → 맵. 빠진 모듈은 기본값. */
export function levelMapFrom(modules) {
  const map = defaultLevelMap()
  for (const m of modules ?? []) if (LEVELS.includes(m.level)) map[m.key] = m.level
  return map
}

/** 'L2' → 'L2 민감'. 화면 문구용. */
export function levelLabel(level) {
  return `${level ?? ''} ${LEVEL_INFO[level]?.name ?? ''}`.trim()
}

/**
 * 이 모듈이 왜 그 레벨인지 한 줄. 확인창·툴팁·팝업 문구에 쓴다.
 * row(GET /security의 한 행 { level, reason })가 기본과 다른 레벨이면 조정 사실과 관리자 사유를 보인다 —
 * 기본 이유만 보이면 올린 레벨(L2)에 낮은 레벨(L0)의 이유가 붙어 어긋났다(2026-11-09·10 QA F2, 사용자 결정 A 2026-11-11).
 * 올릴 때 사유는 선택이라 없으면 기본 이유임을 밝혀 붙인다.
 */
export function securityReasonOf(key, row) {
  const base = MODULE_SECURITY_DEFAULTS[key]?.reason ?? ''
  const def = defaultLevelOf(key)
  if (!row?.level || row.level === def) return base
  const verb = levelRank(row.level) > levelRank(def) ? '올림' : '내림'
  const head = `관리자가 기본 ${def}에서 ${row.level}로 ${verb}`
  return row.reason ? `${head} — ${row.reason}` : `${head} — 사유 미기재 (기본 ${def} 이유: ${base})`
}

const levelOf = (key, levelMap) => levelMap?.[key] ?? defaultLevelOf(key)
const toSet = (keys) => (keys instanceof Set ? keys : new Set(keys ?? []))

/** 켜진 모듈들의 실효 레벨 최댓값. 켜진 것이 없으면 'L0'. */
export function requiredLevelOf(enabledKeys, levelMap) {
  let max = 0
  for (const key of toSet(enabledKeys)) max = Math.max(max, levelRank(levelOf(key, levelMap)))
  return LEVELS[max]
}

/** 공개 허브에서 비밀번호가 필요한(L2+) 켜진 모듈 key들. 비밀번호 허브면 []. */
export function riskyKeysOf(hub, enabledKeys, levelMap) {
  if (hub?.has_password || !enabledKeys) return []
  return [...toSet(enabledKeys)].filter(key => needsPassword(levelOf(key, levelMap)))
}

/**
 * 정책 위반 판정. 위반이 아니면 null.
 * acked = 관리자가 "확인함"을 누를 때의 요구 레벨(hub.security_ack_level) 이하로 유지되는 중.
 * 요구 레벨이 그보다 올라가면 예외가 풀려 다시 경고한다.
 */
export function violationOf(hub, enabledKeys, levelMap) {
  const riskyKeys = riskyKeysOf(hub, enabledKeys, levelMap)
  if (riskyKeys.length === 0) return null
  const required = requiredLevelOf(enabledKeys, levelMap)
  const ack = hub?.security_ack_level
  const acked = ack != null && levelRank(required) <= levelRank(ack)
  return { required, riskyKeys, acked }
}

const unacked = (v) => !!v && !v.acked

/**
 * moduleKey의 레벨을 nextLevel로 바꾸면 새로 "미확인 위반"이 되는 허브 수.
 * 예외가 풀려 다시 경고가 되는 허브도 센다. entries = [{hub, features:[{key}]}].
 */
export function newViolationCount(entries, levelMap, moduleKey, nextLevel) {
  const nextMap = { ...levelMap, [moduleKey]: nextLevel }
  let n = 0
  for (const { hub, features } of entries ?? []) {
    const keys = (features ?? []).map(f => f.key)
    if (!unacked(violationOf(hub, keys, levelMap)) && unacked(violationOf(hub, keys, nextMap))) n++
  }
  return n
}

/**
 * 마이그레이션(20261109000000_module_security) 전이라 테이블·열이 없어 실패한 경우, 토스트에 붙일 안내.
 * 그 외 오류면 ''.
 */
export function migrationHint(e) {
  const msg = String(e?.message ?? '')
  return /schema cache|does not exist|security_ack_level|hub_module_security/.test(msg)
    ? ' — DB 마이그레이션(20261109000000_module_security)이 적용되지 않았을 수 있습니다'
    : ''
}
