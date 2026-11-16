// 백오피스 "마스터 키 변경" — 새 키 두 번 입력, 8자 이상·같아야 저장한다.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import MasterKeySection from './MasterKeySection.jsx'

const fill = (label, v) => fireEvent.change(screen.getByLabelText(label), { target: { value: v } })

describe('MasterKeySection', () => {
  it('두 칸이 다르면 저장하지 않고 안내', () => {
    const onSave = vi.fn()
    render(<MasterKeySection onSave={onSave} />)
    fill('새 마스터 키', 'brand-new-key')
    fill('새 마스터 키 확인', 'brand-new-kez')
    fireEvent.click(screen.getByRole('button', { name: '마스터 키 바꾸기' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/같지 않습니다/)
  })
  it('8자 미만이면 저장하지 않고 안내', () => {
    const onSave = vi.fn()
    render(<MasterKeySection onSave={onSave} />)
    fill('새 마스터 키', 'short')
    fill('새 마스터 키 확인', 'short')
    fireEvent.click(screen.getByRole('button', { name: '마스터 키 바꾸기' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/8자/)
  })
  it('맞으면 저장하고 칸을 비운다', async () => {
    const onSave = vi.fn().mockResolvedValue()
    render(<MasterKeySection onSave={onSave} />)
    fill('새 마스터 키', 'brand-new-key')
    fill('새 마스터 키 확인', 'brand-new-key')
    fireEvent.click(screen.getByRole('button', { name: '마스터 키 바꾸기' }))
    expect(onSave).toHaveBeenCalledWith('brand-new-key')
    await waitFor(() => expect(screen.getByLabelText('새 마스터 키').value).toBe(''))
  })
})
