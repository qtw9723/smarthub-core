// sheet-to-schema 클라 모듈 계약 + 레지스트리 편입 검증
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import mod from './index.jsx'
import { getModule } from '../index.js'

describe('sheet-to-schema 모듈', () => {
  it('클라 계약(key·label·description·icon·loadPanel)을 만족한다', () => {
    expect(mod.key).toBe('sheet-to-schema')
    expect(mod.label).toBe('엑셀 → 스키마 변환')
    expect(typeof mod.description).toBe('string')
    expect(mod.icon).toBeTruthy()
    // 지연 로드 계약: 정적 HubPanel 대신 loadPanel을 노출한다(번들 분리).
    expect(typeof mod.loadPanel).toBe('function')
    expect(mod.HubPanel).toBeUndefined()
    // 패널이 SmartHub 테마 토큰으로 직접 그리므로 밝은 surface 래퍼를 요청하지 않는다
    // (예전 surface 계약은 폐기 — 다른 모듈과 동일해졌다).
    expect(mod.surface).toBeUndefined()
  })

  it('loadPanel이 컴포넌트를 default로 해석한다', async () => {
    const loaded = await mod.loadPanel()
    expect(typeof loaded.default).toBe('function')
  })

  it('무상태 툴이므로 SettingsPanel이 없다', () => {
    expect(mod.SettingsPanel).toBeUndefined()
  })

  it('클라 레지스트리에서 조회된다', () => {
    expect(getModule('sheet-to-schema')).not.toBeNull()
  })

  it('패널이 업로드 단계를 렌더한다', async () => {
    const { default: Panel } = await mod.loadPanel()
    render(<Panel hubKey="cs" />)
    expect(document.body.textContent).toMatch(/업로드|엑셀|파일/)
  })
})
