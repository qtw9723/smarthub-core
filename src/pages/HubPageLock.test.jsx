// 허브 잠금 흐름 — 비밀번호가 걸린 허브에 들어갔을 때 HubPage가 잠금 화면을 띄우고,
// 맞는 비밀번호를 넣으면 그 허브만 열린다.
//
// HubPage.test.jsx와 파일을 나눈 이유: 그쪽은 lazyPanelCache 오염을 피하려고
// 케이스마다 module key를 바꿔 쓴다. 잠금 흐름은 모듈을 렌더하지 않으므로 섞지 않는다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../lib/api/hubs.js', () => ({
  getPublicHubFeatures: vi.fn(),
  HUB_PASSWORD_REQUIRED: 'HUB_PASSWORD_REQUIRED',
  UNKNOWN_HUB: 'UNKNOWN_HUB',
  TOO_MANY_ATTEMPTS: 'TOO_MANY_ATTEMPTS',
}))
vi.mock('../modules/index.js', () => ({ getModule: vi.fn(() => null), getModules: vi.fn(() => []) }))

const mockSetHubCookie = vi.hoisted(() => vi.fn())
vi.mock('../lib/auth.js', () => ({
  setHubCookie: mockSetHubCookie,
  getHubCookie: vi.fn(() => ''),
  getCookie: vi.fn(() => ''),
  clearCookie: vi.fn(),
}))

import HubPage from './HubPage.jsx'
import { getPublicHubFeatures } from '../lib/api/hubs.js'

function lockedError(hub = { key: 'cs', name: 'CS' }) {
  const e = new Error('HUB_PASSWORD_REQUIRED')
  e.hub = hub
  return e
}

const renderHub = (hubKey = 'cs') => render(
  <MemoryRouter initialEntries={[`/hub/${hubKey}`]}>
    <Routes><Route path="/hub/:hubKey" element={<HubPage />} /></Routes>
  </MemoryRouter>,
)

beforeEach(() => { vi.clearAllMocks() })

describe('비밀번호가 걸린 허브', () => {
  it('오류가 아니라 잠금 화면을 띄우고, 허브 이름을 보여준다', async () => {
    getPublicHubFeatures.mockRejectedValue(lockedError())
    renderHub()

    await waitFor(() => expect(screen.getByText('CS')).toBeInTheDocument())
    expect(screen.getByText('이 허브는 비밀번호가 필요합니다')).toBeInTheDocument()
    expect(screen.queryByText(/찾을 수 없습니다/)).not.toBeInTheDocument()
  })

  it('맞는 비밀번호를 넣으면 그 허브 쿠키에만 저장하고 내용이 뜬다', async () => {
    getPublicHubFeatures.mockRejectedValueOnce(lockedError())
    renderHub()
    await waitFor(() => expect(screen.getByPlaceholderText('허브 비밀번호')).toBeInTheDocument())

    // 검증 호출과 잠금 해제 후 재조회가 모두 성공하도록.
    getPublicHubFeatures.mockResolvedValue({ hub: { key: 'cs', name: 'CS' }, features: [] })
    fireEvent.change(screen.getByPlaceholderText('허브 비밀번호'), { target: { value: 'cs-pw' } })
    fireEvent.click(screen.getByRole('button', { name: '확인' }))

    await waitFor(() => expect(mockSetHubCookie).toHaveBeenCalledWith('cs', 'cs-pw'))
    await waitFor(() => expect(screen.getByText('어떤 툴을 사용할까요?')).toBeInTheDocument())
  })

  // 2026-11-10 시도 제한(서버 429) — "연결 오류"가 아니라 기다리라고 알려 준다.
  it('너무 많이 틀려 막히면 몇 분 뒤 다시 하라고 알려 준다', async () => {
    getPublicHubFeatures.mockRejectedValueOnce(lockedError())
    renderHub()
    await waitFor(() => expect(screen.getByPlaceholderText('허브 비밀번호')).toBeInTheDocument())
    const e = new Error('TOO_MANY_ATTEMPTS'); e.retryAfterMinutes = 15
    getPublicHubFeatures.mockRejectedValueOnce(e)
    fireEvent.change(screen.getByPlaceholderText('허브 비밀번호'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    await waitFor(() => expect(screen.getByText('시도가 너무 많습니다. 15분 뒤에 다시 시도해 주세요.')).toBeInTheDocument())
  })

  it('저장 전에 먼저 검증한다 — 틀리면 쿠키에 남기지 않고 오류를 보여준다', async () => {
    getPublicHubFeatures.mockRejectedValue(lockedError())
    renderHub()
    await waitFor(() => expect(screen.getByPlaceholderText('허브 비밀번호')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('허브 비밀번호'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '확인' }))

    await waitFor(() => expect(screen.getByText('비밀번호가 틀렸습니다.')).toBeInTheDocument())
    expect(mockSetHubCookie).not.toHaveBeenCalled()
  })

  it('검증 호출은 입력한 비밀번호를 그 허브 key와 함께 보낸다', async () => {
    getPublicHubFeatures.mockRejectedValue(lockedError({ key: 'delivery', name: 'Delivery' }))
    renderHub('delivery')
    await waitFor(() => expect(screen.getByPlaceholderText('허브 비밀번호')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('허브 비밀번호'), { target: { value: 'delivery-pw' } })
    fireEvent.click(screen.getByRole('button', { name: '확인' }))

    await waitFor(() => expect(getPublicHubFeatures).toHaveBeenCalledWith('delivery', 'delivery-pw'))
  })
})

describe('비밀번호가 없는 허브', () => {
  it('잠금 화면 없이 바로 내용이 뜬다', async () => {
    getPublicHubFeatures.mockResolvedValue({ hub: { key: 'ops', name: 'Ops' }, features: [] })
    renderHub('ops')

    await waitFor(() => expect(screen.getByText('어떤 툴을 사용할까요?')).toBeInTheDocument())
    expect(screen.queryByPlaceholderText('허브 비밀번호')).not.toBeInTheDocument()
  })
})

describe('없는 허브', () => {
  it('잠금이 아니라 오류 화면', async () => {
    getPublicHubFeatures.mockRejectedValue(new Error('UNKNOWN_HUB'))
    renderHub('nope')

    await waitFor(() => expect(screen.getByText(/찾을 수 없습니다/)).toBeInTheDocument())
    expect(screen.queryByPlaceholderText('허브 비밀번호')).not.toBeInTheDocument()
  })
})
