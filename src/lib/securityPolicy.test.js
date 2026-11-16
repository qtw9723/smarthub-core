// src/lib/securityPolicy.test.js — 모듈 보안 레벨 판정.
//
// 백오피스 경고·팝업·확인의 근거다. 레벨은 모듈 단위로 정해지고(사용자가 바꾸지 않음),
// 관리자가 백오피스에서 조정한 값은 {moduleKey: level} 맵으로 들어온다 — 판정 함수는
// 그 맵만 보고, 맵이 없으면 코드 기본값으로 판정한다(경고가 조용히 사라지지 않게).
import { describe, it, expect } from 'vitest'
import { getModules } from '../modules/index.js'
import {
  MODULE_SECURITY_DEFAULTS, levelRank, needsPassword, defaultLevelOf,
  defaultLevelMap, levelMapFrom, securityReasonOf,
  requiredLevelOf, riskyKeysOf, violationOf, newViolationCount, migrationHint,
} from './securityPolicy.js'

const OPEN = { id: 'd', key: 'delivery', name: 'Delivery', has_password: false }
const LOCKED = { id: 'c', key: 'cs', name: 'CS', has_password: true }
const MAP = defaultLevelMap()

describe('기본 레벨 표', () => {
  // 새 모듈을 레지스트리에 넣고 표에 빠뜨리면 조용히 낮은 레벨이 되는 사고를 막는다.
  it('클라 레지스트리의 모든 모듈이 표에 있다', () => {
    for (const m of getModules()) expect(MODULE_SECURITY_DEFAULTS[m.key], m.key).toBeTruthy()
  })

  it('스펙의 기본값 그대로다 — "담을 수 있는 최악" 기준', () => {
    expect(MAP).toEqual({
      'chatbot-monitoring': 'L2', 'grafana-reports': 'L2', mailer: 'L3',
      'sheet-to-schema': 'L0', 'doc-to-api': 'L2',
    })
  })

  it('표에 없는 모듈은 L2로 본다 — 모르면 보호 쪽으로', () => {
    expect(defaultLevelOf('nope')).toBe('L2')
    expect(levelRank('L9')).toBe(2)
  })

  it('비밀번호는 L2부터 요구한다(L1은 안내만)', () => {
    expect(needsPassword('L0')).toBe(false)
    expect(needsPassword('L1')).toBe(false)
    expect(needsPassword('L2')).toBe(true)
    expect(needsPassword('L3')).toBe(true)
  })

  it('모듈별 이유를 돌려준다(기존 문구 유지)', () => {
    expect(securityReasonOf('doc-to-api')).toMatch(/외부 서비스 비용이 청구/)
    expect(securityReasonOf('grafana-reports')).toMatch(/서버 지표·접속 정보/)
  })

  // 2026-11-09·10 QA F2 → 사용자 결정 A(2026-11-11): 올린 레벨에 기본(낮은 레벨) 이유만 보여 레벨과 이유가 어긋났다.
  describe('관리자가 조정한 레벨', () => {
    const DEF = '올린 시트를 변환만 하고 외부 호출·저장된 비밀이 없습니다'
    it('기본과 같거나 행이 없으면 기본 이유', () => {
      expect(securityReasonOf('sheet-to-schema', null)).toBe(DEF)
      expect(securityReasonOf('sheet-to-schema', { level: 'L0', reason: null })).toBe(DEF)
    })
    it('올렸고 사유가 있으면 조정 사실 + 사유', () => {
      expect(securityReasonOf('sheet-to-schema', { level: 'L2', reason: '고객 시트 취급' }))
        .toBe('관리자가 기본 L0에서 L2로 올림 — 고객 시트 취급')
    })
    it('올렸는데 사유가 없으면 조정 사실 + 기본 이유임을 밝힌다', () => {
      expect(securityReasonOf('sheet-to-schema', { level: 'L2', reason: null }))
        .toBe(`관리자가 기본 L0에서 L2로 올림 — 사유 미기재 (기본 L0 이유: ${DEF})`)
    })
    it('내렸으면 내림 + 사유', () => {
      expect(securityReasonOf('mailer', { level: 'L1', reason: '사내 수신자만' }))
        .toBe('관리자가 기본 L3에서 L1로 내림 — 사내 수신자만')
    })
  })
})

describe('levelMapFrom', () => {
  it('GET 응답의 레벨을 쓰고, 빠진 모듈은 기본값', () => {
    const map = levelMapFrom([{ key: 'mailer', level: 'L1' }])
    expect(map.mailer).toBe('L1')
    expect(map['doc-to-api']).toBe('L2')
  })
})

describe('riskyKeysOf — 공개 허브에서 비밀번호가 필요한 켜진 모듈', () => {
  it('L2 이상만 위험으로 본다', () => {
    expect(riskyKeysOf(OPEN, ['sheet-to-schema', 'doc-to-api'], MAP)).toEqual(['doc-to-api'])
  })
  it('비밀번호가 걸린 허브는 위험이 아니다', () => {
    expect(riskyKeysOf(LOCKED, ['doc-to-api', 'mailer'], MAP)).toEqual([])
  })
  it('keys가 없거나 Set이어도 동작한다', () => {
    expect(riskyKeysOf(OPEN, undefined, MAP)).toEqual([])
    expect(riskyKeysOf(OPEN, new Set(['grafana-reports']), MAP)).toEqual(['grafana-reports'])
  })
  it('관리자가 레벨을 내리면 경고 대상에서 빠진다', () => {
    expect(riskyKeysOf(OPEN, ['grafana-reports'], { ...MAP, 'grafana-reports': 'L1' })).toEqual([])
  })
  it('맵이 없으면 기본값으로 판정한다', () => {
    expect(riskyKeysOf(OPEN, ['grafana-reports'], undefined)).toEqual(['grafana-reports'])
  })
})

describe('requiredLevelOf', () => {
  it('켜진 모듈 레벨의 최댓값', () => {
    expect(requiredLevelOf(['sheet-to-schema', 'mailer'], MAP)).toBe('L3')
  })
  it('켜진 것이 없으면 L0', () => {
    expect(requiredLevelOf([], MAP)).toBe('L0')
  })
})

describe('violationOf — 확인된 예외', () => {
  it('비밀번호 허브는 위반이 아니다', () => {
    expect(violationOf(LOCKED, ['mailer'], MAP)).toBeNull()
  })
  it('예외 없이 L2 모듈이 켜진 공개 허브는 미확인 위반', () => {
    expect(violationOf(OPEN, ['grafana-reports'], MAP)).toEqual({ required: 'L2', riskyKeys: ['grafana-reports'], acked: false })
  })
  it('확인 시점 레벨 이하로 유지되면 예외', () => {
    expect(violationOf({ ...OPEN, security_ack_level: 'L2' }, ['grafana-reports'], MAP).acked).toBe(true)
  })
  it('요구 레벨이 확인 시점보다 올라가면 예외가 풀린다', () => {
    expect(violationOf({ ...OPEN, security_ack_level: 'L2' }, ['grafana-reports', 'mailer'], MAP).acked).toBe(false)
  })
})

describe('newViolationCount — 레벨을 올리면 새로 위반이 되는 공개 허브 수', () => {
  const entries = [
    { hub: { ...OPEN, id: 'a' }, features: [{ key: 'sheet-to-schema' }] },
    { hub: { ...OPEN, id: 'b', security_ack_level: 'L2' }, features: [{ key: 'sheet-to-schema' }] },
    { hub: { ...LOCKED, id: 'c' }, features: [{ key: 'sheet-to-schema' }] },
  ]
  it('L2로 올리면 예외가 없는 허브만 센다', () => {
    expect(newViolationCount(entries, MAP, 'sheet-to-schema', 'L2')).toBe(1)
  })
  it('L3로 올리면 예외가 풀리는 허브도 센다', () => {
    expect(newViolationCount(entries, MAP, 'sheet-to-schema', 'L3')).toBe(2)
  })
  it('이미 위반인 허브는 새로 세지 않는다', () => {
    const already = [{ hub: OPEN, features: [{ key: 'sheet-to-schema' }, { key: 'grafana-reports' }] }]
    expect(newViolationCount(already, MAP, 'sheet-to-schema', 'L3')).toBe(0)
  })
})

// 리뷰 지적: 마이그레이션 전 쓰기 실패가 "저장에 실패"로만 보였다 — 원인을 짚어 준다.
describe('migrationHint', () => {
  it('테이블·열이 없다는 오류면 마이그레이션 안내를 붙인다', () => {
    expect(migrationHint(new Error("Could not find the 'security_ack_level' column of 'hubs' in the schema cache"))).toMatch(/마이그레이션/)
    expect(migrationHint(new Error("Could not find the table 'public.hub_module_security' in the schema cache"))).toMatch(/20261109000000/)
  })
  it('다른 오류면 빈 문자열', () => {
    expect(migrationHint(new Error('HTTP 500'))).toBe('')
    expect(migrationHint(undefined)).toBe('')
  })
})
