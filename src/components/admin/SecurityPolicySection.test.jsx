// 백오피스 "보안 정책" 영역 — 관리자가 모듈 레벨을 조정한다(코드 수정 없이).
// 낮출 때는 사유가 필요하고, 올려서 새 위반이 생기면 저장 전에 몇 곳인지 묻는다.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SecurityPolicySection from './SecurityPolicySection.jsx'
import { defaultLevelMap, defaultLevelOf } from '../../lib/securityPolicy.js'
import { getModules } from '../../modules/index.js'

const defaultsModules = () => getModules().map(m => ({ key: m.key, defaultLevel: defaultLevelOf(m.key), level: defaultLevelOf(m.key), reason: null }))

function renderSection({ modules = defaultsModules(), entries = [], state = 'ok', onSave = vi.fn().mockResolvedValue() } = {}) {
  const levelMap = { ...defaultLevelMap(), ...Object.fromEntries(modules.map(m => [m.key, m.level])) }
  render(<SecurityPolicySection modules={modules} entries={entries} levelMap={levelMap} state={state} onSave={onSave} />)
  return onSave
}

describe('SecurityPolicySection', () => {
  it('레벨 정의 표(L0~L3)를 보여준다', () => {
    renderSection()
    for (const name of ['공개', '내부', '민감', '제한']) expect(screen.getAllByText(name).length).toBeGreaterThan(0)
  })

  it('기본보다 낮추는데 사유가 없으면 저장하지 않고 안내한다', () => {
    const onSave = renderSection()
    fireEvent.change(screen.getByLabelText('메일 발송 보안 레벨'), { target: { value: 'L1' } })
    fireEvent.click(screen.getByRole('button', { name: '메일 발송 레벨 저장' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText(/기본보다 낮추려면 사유/)).toBeTruthy()
  })

  it('사유를 넣으면 저장한다', () => {
    const onSave = renderSection()
    fireEvent.change(screen.getByLabelText('메일 발송 보안 레벨'), { target: { value: 'L1' } })
    fireEvent.change(screen.getByLabelText('메일 발송 조정 사유'), { target: { value: '사내 수신자만' } })
    fireEvent.click(screen.getByRole('button', { name: '메일 발송 레벨 저장' }))
    expect(onSave).toHaveBeenCalledWith('mailer', { level: 'L1', reason: '사내 수신자만' })
  })

  it('기본보다 낮게 저장된 모듈에 배지를 단다', () => {
    const modules = defaultsModules().map(m => (m.key === 'mailer' ? { ...m, level: 'L1', reason: '사내만' } : m))
    renderSection({ modules })
    expect(screen.getByTestId('below-default-mailer').textContent).toMatch(/기본보다 낮음/)
    expect(screen.queryByTestId('below-default-doc-to-api')).toBeNull()
  })

  it('올려서 새 위반이 생기면 몇 곳인지 묻고, 취소하면 저장하지 않는다', () => {
    const entries = [{ hub: { id: 'a', key: 'ops', name: 'Ops', has_password: false }, features: [{ key: 'sheet-to-schema' }] }]
    const onSave = renderSection({ entries })
    fireEvent.change(screen.getByLabelText('엑셀 → 스키마 변환 보안 레벨'), { target: { value: 'L2' } })
    fireEvent.click(screen.getByRole('button', { name: '엑셀 → 스키마 변환 레벨 저장' }))
    expect(screen.getByText(/공개 허브 1곳이 정책 위반이 됩니다/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('확인하면 올린 레벨을 저장한다', () => {
    const entries = [{ hub: { id: 'a', key: 'ops', name: 'Ops', has_password: false }, features: [{ key: 'sheet-to-schema' }] }]
    const onSave = renderSection({ entries })
    fireEvent.change(screen.getByLabelText('엑셀 → 스키마 변환 보안 레벨'), { target: { value: 'L2' } })
    fireEvent.click(screen.getByRole('button', { name: '엑셀 → 스키마 변환 레벨 저장' }))
    fireEvent.click(screen.getByRole('button', { name: '계속' }))
    expect(onSave).toHaveBeenCalledWith('sheet-to-schema', { level: 'L2', reason: '' })
  })

  it('위반이 새로 생기지 않으면 묻지 않고 저장한다', () => {
    const onSave = renderSection()
    fireEvent.change(screen.getByLabelText('엑셀 → 스키마 변환 보안 레벨'), { target: { value: 'L1' } })
    fireEvent.click(screen.getByRole('button', { name: '엑셀 → 스키마 변환 레벨 저장' }))
    expect(onSave).toHaveBeenCalledWith('sheet-to-schema', { level: 'L1', reason: '' })
  })

  // 리뷰 지적: 낮출 때 쓴 사유가 올린 뒤에도 그대로 실려 갔다 — 방향이 바뀌면 사유 칸을 비운다.
  it('낮춘 모듈을 기본 위로 올리면 예전 사유는 지우고 빈 사유 칸(선택)을 보인다', () => {
    const modules = defaultsModules().map(m => (m.key === 'chatbot-monitoring' ? { ...m, level: 'L1', reason: '사내 봇만' } : m))
    const onSave = renderSection({ modules })
    fireEvent.change(screen.getByLabelText('챗봇 모니터링 보안 레벨'), { target: { value: 'L3' } })
    expect(screen.getByLabelText('챗봇 모니터링 조정 사유').value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '챗봇 모니터링 레벨 저장' }))
    expect(onSave).toHaveBeenCalledWith('chatbot-monitoring', { level: 'L3', reason: '' })
  })

  // 2026-11-09·10 QA F2 → 사용자 결정 A(2026-11-11): 올릴 때 사유는 선택, 적으면 저장해 화면에 보인다.
  it('기본보다 올릴 때 사유를 적으면 함께 저장한다(선택)', () => {
    const onSave = renderSection()
    fireEvent.change(screen.getByLabelText('엑셀 → 스키마 변환 보안 레벨'), { target: { value: 'L1' } })
    fireEvent.change(screen.getByLabelText('엑셀 → 스키마 변환 조정 사유'), { target: { value: '고객 시트 취급' } })
    fireEvent.click(screen.getByRole('button', { name: '엑셀 → 스키마 변환 레벨 저장' }))
    expect(onSave).toHaveBeenCalledWith('sheet-to-schema', { level: 'L1', reason: '고객 시트 취급' })
  })

  it('기본과 다른 레벨이면 조정 사실과 사유를 보인다', () => {
    const modules = defaultsModules().map(m => (m.key === 'sheet-to-schema' ? { ...m, level: 'L2', reason: '고객 시트 취급' } : m))
    renderSection({ modules })
    expect(screen.getByTestId('adjusted-sheet-to-schema').textContent).toBe('관리자가 기본 L0에서 L2로 올림 — 고객 시트 취급')
  })

  it('레벨을 못 불러왔으면 오류를 보여주고 조정을 막는다', () => {
    renderSection({ state: 'error' })
    expect(screen.getByText(/불러오지 못해/)).toBeTruthy()
    expect(screen.getByLabelText('메일 발송 보안 레벨').disabled).toBe(true)
  })
})
