// 작업 모달의 본문 형식(텍스트/HTML) 선택 계약.
import { describe, it, expect, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { render, screen, fireEvent } from '@testing-library/react'
import JobModal from './JobModal.jsx'

const uploadFile = vi.hoisted(() => vi.fn())
const deleteFile = vi.hoisted(() => vi.fn())
vi.mock('../../lib/storage.js', () => ({ uploadFile, deleteFile }))

const SENDERS = [{ id: 's1', email: 'a@b.com' }]

function open(job, extra = {}) {
  const onSubmit = vi.fn()
  render(<JobModal job={job} senders={SENDERS} onSubmit={onSubmit} onClose={() => {}} loading={false} {...extra} />)
  return onSubmit
}

const preview = () => document.querySelector('.body-preview')

describe('JobModal 본문 형식', () => {
  it('신규 작업은 텍스트가 기본이고 미리보기가 없다', () => {
    open(null)
    expect(screen.getByRole('radio', { name: '텍스트' })).toBeChecked()
    expect(screen.queryByRole('button', { name: '미리보기' })).not.toBeInTheDocument()
  })

  it('HTML을 고르면 미리보기 토글이 나타난다', () => {
    open(null)
    fireEvent.click(screen.getByRole('radio', { name: 'HTML' }))
    expect(screen.getByRole('button', { name: '미리보기' })).toBeInTheDocument()
  })

  // 붙여넣은 템플릿의 CSS·스크립트가 앱을 건드리지 못하도록 sandbox iframe으로 격리한다.
  it('미리보기는 sandbox iframe으로 본문을 격리해 렌더한다', () => {
    open(null)
    fireEvent.click(screen.getByRole('radio', { name: 'HTML' }))
    fireEvent.change(screen.getByLabelText('메일 본문'), { target: { value: '<b>안녕</b>' } })
    fireEvent.click(screen.getByRole('button', { name: '미리보기' }))

    expect(preview()).not.toBeNull()
    expect(preview().getAttribute('sandbox')).toBe('')
    expect(preview().getAttribute('srcdoc')).toBe('<b>안녕</b>')
  })

  it('텍스트로 되돌리면 미리보기가 닫힌다', () => {
    open(null)
    fireEvent.click(screen.getByRole('radio', { name: 'HTML' }))
    fireEvent.click(screen.getByRole('button', { name: '미리보기' }))
    fireEvent.click(screen.getByRole('radio', { name: '텍스트' }))

    expect(preview()).toBeNull()
  })

  it('저장 payload에 body_format을 담는다', () => {
    const onSubmit = open(null)
    fireEvent.change(screen.getByLabelText('작업 이름'), { target: { value: '주간' } })
    fireEvent.change(screen.getByLabelText('메일 제목'), { target: { value: '제목' } })
    fireEvent.change(screen.getByLabelText('메일 본문'), { target: { value: '<p>본문</p>' } })
    fireEvent.click(screen.getByRole('radio', { name: 'HTML' }))
    fireEvent.submit(screen.getByRole('button', { name: '생성' }).closest('form'))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ body_format: 'html', body: '<p>본문</p>' }))
  })

  it('기존 잡의 body_format을 초기값으로 읽는다', () => {
    open({ id: 'j1', name: 'A', subject: 'S', body: '<p>B</p>', body_format: 'html', recipients: ['a@b.com'], interval_minutes: 60 })
    expect(screen.getByRole('radio', { name: 'HTML' })).toBeChecked()
  })
})

// 첨부 인가가 서버로 옮겨갔으므로(ROADMAP v0.5.0), 모달은 자기가 속한 허브를 함께 넘겨야 한다.
// 넘기지 않으면 서버가 어느 허브의 권한으로 서명할지 알 수 없어 업로드가 통째로 막힌다.
describe('JobModal 첨부 인가 컨텍스트', () => {
  it('업로드할 때 허브와 비밀번호를 함께 넘긴다', async () => {
    uploadFile.mockResolvedValue({ path: 'p', name: 'a.pdf', size: 1 })
    open(null, { hubKey: 'cs', password: 'pw' })
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' })

    fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } })

    await waitFor(() => expect(uploadFile).toHaveBeenCalled())
    expect(uploadFile.mock.calls[0][2]).toEqual({ hub: 'cs', password: 'pw' })
  })

  it('첨부를 지울 때도 같은 컨텍스트를 넘긴다', async () => {
    deleteFile.mockResolvedValue(undefined)
    const job = { id: 'j1', name: 'j', recipients: [], interval_minutes: 60,
      attachments: [{ path: 'hub/f/a.pdf', name: 'a.pdf', size: 1 }] }
    open(job, { hubKey: 'cs', password: 'pw' })

    fireEvent.click(document.querySelector('.attachment-remove'))

    await waitFor(() => expect(deleteFile).toHaveBeenCalled())
    expect(deleteFile.mock.calls[0][1]).toEqual({ hub: 'cs', password: 'pw' })
  })
})
