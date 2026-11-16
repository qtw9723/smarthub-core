import { describe, it, expect } from 'vitest'
import { diffLines, diffStats } from './diff.js'

describe('diffLines', () => {
  it('같은 텍스트는 전부 same', () => {
    expect(diffLines('a\nb', 'a\nb').every(x => x.type === 'same')).toBe(true)
  })
  it('추가·삭제를 구분한다', () => {
    expect(diffLines('a\nb\nc', 'a\nc\nd')).toEqual([
      { type: 'same', text: 'a' }, { type: 'del', text: 'b' }, { type: 'same', text: 'c' }, { type: 'add', text: 'd' },
    ])
  })
  it('빈 입력', () => {
    expect(diffLines('', 'x')).toEqual([{ type: 'add', text: 'x' }])
    expect(diffLines('x', '')).toEqual([{ type: 'del', text: 'x' }])
    expect(diffLines('', '')).toEqual([])
  })
  it('통계', () => {
    expect(diffStats(diffLines('a\nb', 'b\nc'))).toEqual({ added: 1, removed: 1 })
  })
})
