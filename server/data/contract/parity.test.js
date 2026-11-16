// 두 저장소 구현(외부 supabase · 사내 pg)이 같은 영역·같은 함수를 가진다 — 한쪽에만 함수를 추가하면 여기서 실패한다.
import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'node:child_process'

vi.mock('../../db.js', () => ({ default: { from: () => ({}) } }))
const { repos: supa } = await import('../supabase/index.js')
const { repos: pg } = await import('../pg/index.js')

// 영역 안에 하위 객체(chatbots.settings 등)가 있으면 그 함수 이름까지 비교한다.
const shape = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) =>
  [k, typeof v === 'function' ? 'fn' : shape(v)]))

describe('저장소 구현 일치', () => {
  it('영역과 함수 이름이 같다', () => {
    expect(shape(pg)).toEqual(shape(supa))
  })
})

// 저장소 밖에서 테이블을 직접 부르면 사내(pg) 에디션에서 그 경로만 Supabase로 간다 — 남지 않게 막는다.
// 스토리지(.storage.from)는 3/4 첨부 드라이버 전까지 예외.
describe('저장소 밖 직접 DB 호출 없음', () => {
  it('server/·scripts/에서 server/data/supabase/ 밖 .from( 테이블 호출이 0건', () => {
    let out = ''
    try {
      out = execFileSync('git', ['grep', '-nE', "\\.from\\(['A-Z]", '--', 'server', 'scripts'], { encoding: 'utf8' })
    } catch (e) {
      if (e.status !== 1) throw e // 1 = 일치 없음
    }
    const hits = out.split('\n').filter(Boolean)
      .filter((l) => !/^server\/data\/supabase\//.test(l))
      .filter((l) => !/\.test\.|__test__|server\/data\/contract\//.test(l))
      .filter((l) => !/\.storage\.from\(/.test(l))
    expect(hits).toEqual([])
  })
})
