// src/lib/securityPolicy.test.js — 모듈 보안 레벨 판정.
//
// 레벨은 모듈 단위로 정해지고, 관리자가 조정한 값은 {moduleKey: level} 맵으로 들어온다.
// 판정 함수는 그 맵만 본다 — 맵이 없으면 코드 기본값으로 판정한다(경고가 조용히 사라지지 않게).
import { describe, it, expect } from 'vitest'
import { getModules } from '../modules/index.js'
import {
  MODULE_SECURITY_DEFAULTS, levelRank, needsPassword,
  defaultLevelMap, levelMapFrom,
  requiredLevelOf, riskyKeysOf, violationOf, newViolationCount,
} from './securityPolicy.js'

const OPEN = { id: 'd', key: 'delivery', name: 'Delivery', has_password: false }
const LOCKED = { id: 'c', key: 'cs', name: 'CS', has_password: true }
const MAP = defaultLevelMap()
const KEY = 'chatbot-monitoring'

describe('기본 레벨 표', () => {
  // 새 모듈을 레지스트리에 넣고 표에 빠뜨리면 조용히 낮은 레벨이 되는 사고를 막는다.
  it('클라 레지스트리의 모든 모듈이 표에 있다', () => {
    for (const m of getModules()) expect(MODULE_SECURITY_DEFAULTS[m.key], m.key).toBeTruthy()
  })
  it('기본값', () => {
    expect(MAP).toEqual({ [KEY]: 'L2' })
  })
  it('레벨 순위와 비밀번호 요구(L2부터)', () => {
    expect(levelRank('L0')).toBeLessThan(levelRank('L3'))
    expect(needsPassword('L1')).toBe(false)
    expect(needsPassword('L2')).toBe(true)
  })
})

describe('levelMapFrom', () => {
  it('GET 응답의 레벨을 쓴다', () => {
    expect(levelMapFrom([{ key: KEY, level: 'L1' }])[KEY]).toBe('L1')
  })
  it('응답이 비면 기본값', () => {
    expect(levelMapFrom([])[KEY]).toBe('L2')
  })
})

describe('판정', () => {
  it('요구 레벨은 켜진 모듈 레벨의 최댓값', () => {
    expect(requiredLevelOf([KEY], MAP)).toBe('L2')
    expect(requiredLevelOf([KEY], { [KEY]: 'L3' })).toBe('L3')
  })
  it('공개 허브에서 비밀번호가 필요한 모듈만 위험으로 본다', () => {
    expect(riskyKeysOf(OPEN, [KEY], MAP)).toEqual([KEY])
    expect(riskyKeysOf(OPEN, [KEY], { [KEY]: 'L1' })).toEqual([])
    expect(riskyKeysOf(LOCKED, [KEY], MAP)).toEqual([])
  })
  it('확인된 예외는 요구 레벨이 올라가면 풀린다', () => {
    const hub = { ...OPEN, security_ack_level: 'L2' }
    expect(violationOf(hub, [KEY], MAP)).toMatchObject({ acked: true })
    expect(violationOf(hub, [KEY], { [KEY]: 'L3' })).toMatchObject({ acked: false })
  })
  it('레벨을 올려 새로 위반이 되는 공개 허브 수', () => {
    const entries = [
      { hub: OPEN, features: [{ key: KEY }] },
      { hub: LOCKED, features: [{ key: KEY }] },
    ]
    expect(newViolationCount(entries, { [KEY]: 'L1' }, KEY, 'L2')).toBe(1)
  })
})
