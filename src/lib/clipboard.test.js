// 사내 에디션(http)에는 navigator.clipboard가 없다(보안 컨텍스트 전용) — 숨은 textarea + execCommand로 복사한다.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { copyText } from './clipboard.js'

afterEach(() => vi.unstubAllGlobals())

describe('copyText', () => {
  it('navigator.clipboard가 있으면 그것을 쓴다', async () => {
    const writeText = vi.fn().mockResolvedValue()
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await copyText('abc')
    expect(writeText).toHaveBeenCalledWith('abc')
  })
  it('http라 없으면 execCommand로 복사하고, 숨은 칸은 남기지 않는다', async () => {
    vi.stubGlobal('navigator', {})
    let copied = null
    document.execCommand = vi.fn(() => { copied = document.activeElement?.value ?? null; return true })
    await copyText('xyz')
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(copied).toBe('xyz')
    expect(document.querySelector('textarea')).toBeNull()
  })
  it('둘 다 안 되면 던진다 — 부르는 쪽이 "직접 복사" 안내를 띄운다', async () => {
    vi.stubGlobal('navigator', {})
    document.execCommand = vi.fn(() => false)
    await expect(copyText('x')).rejects.toThrow()
  })
})
