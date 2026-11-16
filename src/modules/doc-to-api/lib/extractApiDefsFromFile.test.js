// 파일 경로는 "텍스트 추출"만 자기 몫이고, 그 뒤는 붙여넣기와 같은 경로를 쓴다.
import { describe, it, expect, vi } from 'vitest'
import { extractApiDefsFromFile } from './extractApiDefsFromFile.js'

const OPENAPI = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 't', version: '1' },
  paths: { '/ping': { get: { summary: '핑', responses: { 200: { description: 'ok' } } } } },
})

const file = { name: 'doc.json' }

describe('extractApiDefsFromFile', () => {
  it('텍스트 추출 실패는 그 이유를 그대로 돌려준다 — LLM을 부르지 않는다', async () => {
    const callApiDocParse = vi.fn()
    const r = await extractApiDefsFromFile(file, {
      extractText: async () => { throw new Error('암호가 걸린 PDF입니다') },
      callApiDocParse,
    })
    expect(r.error).toBe('암호가 걸린 PDF입니다')
    expect(r.defs).toEqual([])
    expect(callApiDocParse).not.toHaveBeenCalled()
  })

  it('추출 실패에 메시지가 없으면 기본 문구를 쓴다', async () => {
    const r = await extractApiDefsFromFile(file, {
      extractText: async () => { throw new Error() },
      callApiDocParse: vi.fn(),
    })
    expect(r.error).toBeTruthy()
  })

  it('OpenAPI 파일은 결정론으로 처리하고 source를 붙인다', async () => {
    const callApiDocParse = vi.fn()
    const r = await extractApiDefsFromFile(file, { extractText: async () => OPENAPI, callApiDocParse })
    expect(r.source).toBe('openapi')
    expect(r.defs.length).toBeGreaterThan(0)
    expect(callApiDocParse).not.toHaveBeenCalled()
  })

  it('자유형식 파일은 LLM으로 넘긴다', async () => {
    const r = await extractApiDefsFromFile(file, {
      extractText: async () => '엑셀에서 뽑은 설명 텍스트',
      callApiDocParse: async () => ({ defs: [{ name: 'x' }] }),
    })
    expect(r.source).toBe('llm')
    expect(r.defs).toEqual([{ name: 'x' }])
  })

  it('빈 파일은 붙여넣기와 같은 오류 경로를 탄다', async () => {
    const callApiDocParse = vi.fn()
    const r = await extractApiDefsFromFile(file, { extractText: async () => '  ', callApiDocParse })
    expect(r.defs).toEqual([])
    expect(r.error).toBeTruthy()
    expect(callApiDocParse).not.toHaveBeenCalled()
  })
})
