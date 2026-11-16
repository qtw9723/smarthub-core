// 붙여넣기 경로의 계약. 파일 업로드 경로만 테스트로 고정돼 있고 붙여넣기는 별개 구현이라
// 검증이 없었다(ROADMAP 백로그). 두 입력이 같은 결과를 내야 한다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HubPanel from './HubPanel.jsx'

const parseApiDoc = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api/docToApi.js', () => ({ parseApiDoc }))
vi.mock('../../lib/auth.js', () => ({ getCookie: () => 'pw', hubAuthHeaders: () => ({}) }))

const OPENAPI = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 't', version: '1' },
  paths: { '/ping': { get: { summary: '핑', responses: { 200: { description: 'ok' } } } } },
})

function open() {
  render(<MemoryRouter><HubPanel hubKey="cs" /></MemoryRouter>)
  return screen.getByRole('textbox')
}
const extract = () => fireEvent.click(screen.getByRole('button', { name: /API 추출/ }))

beforeEach(() => vi.clearAllMocks())

describe('doc-to-api 붙여넣기 경로', () => {
  it('OpenAPI를 붙여넣으면 LLM을 부르지 않고 검토 단계로 간다', async () => {
    fireEvent.change(open(), { target: { value: OPENAPI } })
    extract()
    await waitFor(() => expect(screen.getByText(/추출된 API/)).toBeInTheDocument())
    expect(parseApiDoc).not.toHaveBeenCalled()
  })

  it('붙여넣기도 추출 방식 배지를 보여준다 — 파일 업로드와 같아야 한다', async () => {
    fireEvent.change(open(), { target: { value: OPENAPI } })
    extract()
    await waitFor(() => expect(screen.getByText('OpenAPI 결정론')).toBeInTheDocument())
  })

  it('자유형식은 LLM으로 넘기고 그 배지를 보여준다', async () => {
    parseApiDoc.mockResolvedValue({ defs: [{ name: '회원조회', method: 'GET', path: '/users' }] })
    fireEvent.change(open(), { target: { value: '회원 조회 API가 있습니다' } })
    extract()
    await waitFor(() => expect(screen.getByText('문서(LLM)')).toBeInTheDocument())
    expect(parseApiDoc).toHaveBeenCalledWith('회원 조회 API가 있습니다', 'pw', 'cs')
  })

  it('LLM이 아무것도 못 찾으면 안내를 띄우고 검토로 넘어가지 않는다', async () => {
    parseApiDoc.mockResolvedValue({ defs: [] })
    fireEvent.change(open(), { target: { value: '아무 말' } })
    extract()
    await waitFor(() => expect(screen.getByText(/추출하지 못했습니다/)).toBeInTheDocument())
    expect(screen.queryByText(/추출된 API/)).not.toBeInTheDocument()
  })

  it('LLM 호출이 실패하면 그 이유를 보여준다', async () => {
    parseApiDoc.mockRejectedValue(new Error('허브 기능이 꺼져 있습니다'))
    fireEvent.change(open(), { target: { value: '아무 말' } })
    extract()
    await waitFor(() => expect(screen.getByText('허브 기능이 꺼져 있습니다')).toBeInTheDocument())
  })

  it('빈 입력이면 추출 버튼이 비활성이다', () => {
    open()
    expect(screen.getByRole('button', { name: /API 추출/ })).toBeDisabled()
  })
})
