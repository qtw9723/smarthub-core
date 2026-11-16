import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { resolveConn } from './client.js'

const SAVE = {}
beforeEach(() => {
  for (const k of ['GRAFANA_URL', 'GRAFANA_TOKEN', 'PROM_UID', 'ES_UID']) SAVE[k] = process.env[k]
})
afterEach(() => {
  for (const k of ['GRAFANA_URL', 'GRAFANA_TOKEN', 'PROM_UID', 'ES_UID']) {
    if (SAVE[k] === undefined) delete process.env[k]; else process.env[k] = SAVE[k]
  }
})

describe('resolveConn', () => {
  it('소스 연결값을 우선 사용하고 url 끝 슬래시 제거', () => {
    const c = resolveConn({ base_url: 'https://g.example/', token: 'tok', prom_uid: 'p1', es_uid: 'e1' })
    expect(c).toEqual({ url: 'https://g.example', token: 'tok', promUid: 'p1', esUid: 'e1' })
  })

  it('소스 연결값이 비면 ENV로 폴백', () => {
    process.env.GRAFANA_URL = 'https://env.example'
    process.env.GRAFANA_TOKEN = 'envtok'
    process.env.PROM_UID = 'ep'
    process.env.ES_UID = 'ee'
    const c = resolveConn({})
    expect(c).toEqual({ url: 'https://env.example', token: 'envtok', promUid: 'ep', esUid: 'ee' })
  })

  it('소스가 일부만 채우면 나머지는 ENV 폴백(부분 오버라이드)', () => {
    process.env.GRAFANA_URL = 'https://env.example'
    process.env.GRAFANA_TOKEN = 'envtok'
    process.env.PROM_UID = 'ep'
    process.env.ES_UID = 'ee'
    const c = resolveConn({ base_url: 'https://src.example' })
    expect(c.url).toBe('https://src.example')
    expect(c.token).toBe('envtok')
  })

  it('url/token 둘 다 없으면 예외', () => {
    delete process.env.GRAFANA_URL
    delete process.env.GRAFANA_TOKEN
    expect(() => resolveConn({})).toThrow(/연결정보 미설정/)
  })
})
