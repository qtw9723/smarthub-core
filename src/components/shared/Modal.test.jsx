// 공용 모달 셸 계약 — 최초 1회 포커스, ESC 닫기.
//
// 핵심 회귀: 모달 안에서 타이핑하면 부모(JobModal 등)가 리렌더되며 onClose 인라인
// 핸들러의 참조가 매번 새로 생긴다. 이때 셸이 다시 포커스를 잡아가면 입력 중인
// 필드가 blur되고, 한글 IME는 조합 중이던 글자가 통째로 날아간다.
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import Modal from './Modal.jsx'

// 실제 소비처 모양: 입력 상태를 들고 있고 onClose를 인라인으로 넘긴다.
function Host() {
  const [value, setValue] = useState('')
  return (
    <Modal title="작업" onClose={() => {}}>
      <input aria-label="이름" value={value} onChange={(e) => setValue(e.target.value)} />
    </Modal>
  )
}

describe('Modal', () => {
  it('열릴 때 다이얼로그에 포커스를 준다', () => {
    render(<Modal title="작업" onClose={() => {}}><input aria-label="이름" /></Modal>)
    expect(document.activeElement).toBe(screen.getByRole('dialog'))
  })

  it('입력 중 리렌더가 일어나도 포커스를 뺏지 않는다', () => {
    render(<Host />)
    const input = screen.getByLabelText('이름')
    input.focus()

    fireEvent.change(input, { target: { value: 'ㄱ' } })
    expect(document.activeElement).toBe(input)

    fireEvent.change(input, { target: { value: '가' } })
    expect(document.activeElement).toBe(input)
  })

  it('ESC로 닫는다 — 핸들러 참조가 바뀌어도 최신 핸들러가 호출된다', () => {
    const first = vi.fn()
    const { rerender } = render(<Modal title="작업" onClose={first}><span>본문</span></Modal>)

    const latest = vi.fn()
    rerender(<Modal title="작업" onClose={latest}><span>본문</span></Modal>)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(latest).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })
})
