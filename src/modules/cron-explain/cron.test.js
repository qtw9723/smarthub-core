import { describe, it, expect } from 'vitest'
import { parseCron, explainCron, nextRuns } from './cron.js'

describe('parseCron', () => {
  it('필드 수가 다르면 오류', () => {
    expect(() => parseCron('* * * *')).toThrow('5개')
  })
  it('범위·간격·목록', () => {
    const { sets } = parseCron('0,30 9-11 */10 * 1-5')
    expect([...sets[0]]).toEqual([0, 30])
    expect([...sets[1]]).toEqual([9, 10, 11])
    expect([...sets[2]]).toEqual([1, 11, 21, 31])
    expect([...sets[4]]).toEqual([1, 2, 3, 4, 5])
  })
  it('범위를 벗어나면 오류, 요일 7은 일요일', () => {
    expect(() => parseCron('60 * * * *')).toThrow()
    expect([...parseCron('* * * * 7').sets[4]]).toEqual([0])
  })
})

describe('explainCron', () => {
  it('매일 정시', () => expect(explainCron('0 9 * * *')).toBe('9시 0분에 실행'))
  it('N분마다', () => expect(explainCron('*/5 * * * *')).toBe('5분마다 실행'))
  it('요일 지정', () => expect(explainCron('30 18 * * 1-5')).toBe('월·화·수·목·금요일 18시 30분에 실행'))
})

describe('nextRuns', () => {
  const from = new Date(2026, 10, 16, 8, 59, 30) // 2026-11-16(월) 08:59:30
  it('다음 실행은 from 이후', () => {
    const r = nextRuns('0 9 * * *', from, 2)
    expect(r.map(d => [d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()])).toEqual([[11, 16, 9, 0], [11, 17, 9, 0]])
  })
  it('주말은 건너뛴다', () => {
    const fri = new Date(2026, 10, 20, 10, 0, 0)
    const r = nextRuns('0 9 * * 1-5', fri, 1)
    expect(r[0].getDay()).toBe(1)
  })
  it('일과 요일을 모두 지정하면 둘 중 하나만 맞아도 실행', () => {
    const r = nextRuns('0 0 1 * 1', new Date(2026, 10, 16, 0, 0, 0), 3)
    expect(r.every(d => d.getDate() === 1 || d.getDay() === 1)).toBe(true)
  })
})
