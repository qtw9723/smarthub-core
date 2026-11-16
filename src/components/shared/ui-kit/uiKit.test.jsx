// UI 프리미티브 스모크 — 렌더 가능성과 export 형태만 검증한다.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StepBar from './StepBar.jsx'
import UploadZone from './UploadZone.jsx'
import Input from './Input.jsx'
import Select from './Select.jsx'
import Checkbox from './Checkbox.jsx'
import Button from './Button.jsx'
import { Panel } from './Card.jsx'

describe('UI 프리미티브', () => {
  it('7개 프리미티브가 모두 컴포넌트로 export된다', () => {
    for (const C of [StepBar, UploadZone, Input, Select, Checkbox, Button, Panel]) {
      expect(typeof C === 'function' || typeof C === 'object').toBe(true)
    }
  })

  it('Button이 자식을 렌더한다', () => {
    render(<Button>생성</Button>)
    expect(screen.getByText('생성')).toBeInTheDocument()
  })

  it('Panel이 자식을 렌더한다', () => {
    render(<Panel>본문</Panel>)
    expect(screen.getByText('본문')).toBeInTheDocument()
  })

  // 팔레트 계약: 프리미티브는 SmartHub 테마 토큰 유틸리티만 쓴다. 원본의 밝은 테마
  // 값(#0052CC·bg-white 등)이 다시 섞여 들어오면 어두운 배경에서 대비가 무너진다.
  it('Button primary가 accent 토큰을 쓴다(원본 primary 팔레트 잔존 금지)', () => {
    render(<Button>생성</Button>)
    const cls = screen.getByRole('button').className
    expect(cls).toContain('bg-accent')
    expect(cls).not.toMatch(/primary-|bg-white|#0052CC/)
  })
})
