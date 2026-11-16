// 백오피스 진입 팝업 — 위반 허브와 그 이유를 보인다.
// 2026-11-09·10 QA F2 → 사용자 결정 A(2026-11-11): 관리자가 올린 레벨에는 기본(낮은 레벨) 이유가 아니라 조정 사실·사유를 보인다.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import SecurityViolationPopup from './SecurityViolationPopup.jsx'

const hub = { id: 'h', key: 'ops', name: 'Ops', has_password: false }
const violations = [{ hub, required: 'L2', riskyKeys: ['sheet-to-schema'] }]
const props = { violations, levelMap: { 'sheet-to-schema': 'L2' }, onSetPassword: vi.fn(), onAck: vi.fn(), onClose: vi.fn() }

describe('SecurityViolationPopup', () => {
  it('올린 모듈은 조정 사실과 관리자 사유를 보인다', () => {
    render(<SecurityViolationPopup {...props} securityRows={[{ key: 'sheet-to-schema', level: 'L2', reason: '고객 시트 취급' }]} />)
    expect(screen.getByText(/관리자가 기본 L0에서 L2로 올림 — 고객 시트 취급/)).toBeTruthy()
    expect(screen.queryByText(/외부 호출·저장된 비밀이 없습니다/)).toBeNull()
  })
  it('행이 없으면(불러오기 전) 기본 이유', () => {
    render(<SecurityViolationPopup {...props} levelMap={{ 'sheet-to-schema': 'L0' }} />)
    expect(screen.getByText(/외부 호출·저장된 비밀이 없습니다/)).toBeTruthy()
  })
})
