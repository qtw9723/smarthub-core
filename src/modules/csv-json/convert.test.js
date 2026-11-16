import { describe, it, expect } from 'vitest'
import { parseCsv, csvToJson, jsonToCsv } from './convert.js'

describe('parseCsv', () => {
  it('따옴표 안의 쉼표·줄바꿈·이중 따옴표를 처리한다', () => {
    expect(parseCsv('a,"b,1","c ""q""\nx"\n1,2,3')).toEqual([['a', 'b,1', 'c "q"\nx'], ['1', '2', '3']])
  })
  it('CRLF·BOM·끝 빈 줄을 무시한다', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n\r\n')).toEqual([['a', 'b'], ['1', '2']])
  })
})

describe('csvToJson', () => {
  it('헤더로 객체를 만들고 부족한 칸은 빈 문자열', () => {
    expect(csvToJson('name,age\nkim,30\nlee')).toEqual([{ name: 'kim', age: '30' }, { name: 'lee', age: '' }])
  })
  it('중복·빈 헤더는 고유하게', () => {
    expect(csvToJson('a,a,\n1,2,3')).toEqual([{ a: '1', a_2: '2', col3: '3' }])
  })
  it('header:false면 2차원 배열', () => {
    expect(csvToJson('1,2\n3,4', { header: false })).toEqual([['1', '2'], ['3', '4']])
  })
})

describe('jsonToCsv', () => {
  it('열은 등장 순서의 합집합, 특수문자는 따옴표', () => {
    expect(jsonToCsv([{ a: 1, b: 'x,y' }, { a: 2, c: 'q"r' }])).toBe('a,b,c\n1,"x,y",\n2,,"q""r"')
  })
  it('중첩 값은 JSON 문자열로', () => {
    expect(jsonToCsv([{ a: { k: 1 } }])).toBe('a\n"{""k"":1}"')
  })
  it('배열이 아니면 오류', () => {
    expect(() => jsonToCsv({})).toThrow()
  })
  it('왕복: csv → json → csv', () => {
    const csv = 'a,b\n1,"x,y"\n2,z'
    expect(jsonToCsv(csvToJson(csv))).toBe(csv)
  })
})
