// 사내 에디션은 http(사내망)라 브라우저가 crypto.randomUUID를 주지 않는다(보안 컨텍스트 전용) — 설정 화면이 "설정을 불러오지 못했습니다"로 멈추던 원인. getRandomValues는 http에서도 있으므로 그것으로 v4를 만든다.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomId } from './uuid.js'

globalThis.__realCrypto = globalThis.crypto

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => vi.unstubAllGlobals())

describe('randomId', () => {
  it('randomUUID가 없는 http 화면에서도 v4 UUID를 만든다', () => {
    vi.stubGlobal('crypto', { getRandomValues: (a) => globalThis.__realCrypto.getRandomValues(a) })
    const ids = new Set(Array.from({ length: 50 }, () => randomId()))
    expect(ids.size).toBe(50)
    for (const id of ids) expect(id).toMatch(V4)
  })
  it('randomUUID가 있으면 그것을 쓴다', () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'from-native', getRandomValues: () => { throw new Error('unused') } })
    expect(randomId()).toBe('from-native')
  })
})

describe('화면 코드는 crypto.randomUUID를 직접 부르지 않는다', () => {
  it('src/ 전체에서 uuid.js만 쓴다', () => {
    const root = resolve(process.cwd(), 'src')
    const hits = []
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(js|jsx)$/.test(name) && !/\.test\./.test(name) && !p.endsWith(join('lib', 'uuid.js'))
          && readFileSync(p, 'utf8').includes('crypto.randomUUID(')) hits.push(p.slice(root.length + 1))
      }
    }
    walk(root)
    expect(hits).toEqual([])
  })
})
