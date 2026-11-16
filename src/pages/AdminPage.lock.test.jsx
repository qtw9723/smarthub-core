// 백오피스 "기본 잠금" 계약 — 허브가 공개가 되는 두 갈래를 모두 의식적 행동으로 만든다.
//
//   갈래 1: 허브를 비밀번호 없이 만든다      → 공개로 만든다고 명시해야 한다
//   갈래 2: 공개 허브에 비용 모듈을 켠다      → 무엇이 열리는지 확인해야 한다
//
// 판정(riskyKeysOf)과 사후 표시는 AdminPage.risk.test.jsx가 본다. 여기는 **사전 차단**이다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/api/admin.js', () => ({
  getOverview: vi.fn(), getActivity: vi.fn(), createHub: vi.fn(),
  updateHub: vi.fn(), deleteHub: vi.fn(), setHubFeature: vi.fn(), setHubPassword: vi.fn(),
  getSecurity: vi.fn(), setModuleSecurity: vi.fn(), setHubSecurityAck: vi.fn(),
}))
vi.mock('../lib/auth.js', () => ({ getCookie: () => 'pw', clearCookie: vi.fn() }))

import AdminPage from './AdminPage.jsx'
import { getOverview, getActivity, createHub, setHubFeature, setHubPassword } from '../lib/api/admin.js'

function renderAdmin(entries = []) {
  getOverview.mockResolvedValue(entries)
  getActivity.mockResolvedValue({ events: [], automations: [] })
  return render(<MemoryRouter><AdminPage /></MemoryRouter>)
}

async function openAddForm() {
  fireEvent.click(await screen.findByRole('button', { name: /허브 추가/ }))
  fireEvent.change(screen.getByPlaceholderText('ops'), { target: { value: 'ops' } })
  fireEvent.change(screen.getByPlaceholderText('Ops'), { target: { value: 'Ops' } })
}

beforeEach(() => { vi.clearAllMocks(); createHub.mockResolvedValue({}) })

describe('허브 생성', () => {
  it('비밀번호도 공개 확인도 없으면 만들지 않는다', async () => {
    renderAdmin()
    await openAddForm()
    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    await waitFor(() => expect(createHub).not.toHaveBeenCalled())
  })

  it('비밀번호를 넣으면 그 비밀번호와 함께 만든다', async () => {
    renderAdmin()
    await openAddForm()
    fireEvent.change(screen.getByLabelText(/허브 비밀번호/), { target: { value: 'ops-pw' } })
    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    await waitFor(() => expect(createHub).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'ops', name: 'Ops', password: 'ops-pw' }), 'pw'))
  })

  it('공개 확인을 체크하면 공개 허브로 만든다', async () => {
    renderAdmin()
    await openAddForm()
    fireEvent.click(screen.getByLabelText(/공개로 만듭니다/))
    fireEvent.click(screen.getByRole('button', { name: '추가' }))
    await waitFor(() => expect(createHub).toHaveBeenCalledWith(
      expect.objectContaining({ public_ack: true }), 'pw'))
    expect(createHub.mock.calls[0][0].password).toBeFalsy()
  })
})

describe('공개 허브에 비용 모듈 켜기', () => {
  const publicHub = [{
    hub: { id: 'd-id', key: 'delivery', name: 'Delivery', enabled: true, has_password: false },
    features: [],
  }]
  const lockedHub = [{
    hub: { id: 'c-id', key: 'cs', name: 'CS', enabled: true, has_password: true },
    features: [],
  }]

  it('바로 켜지지 않고 확인을 먼저 묻는다', async () => {
    renderAdmin(publicHub)
    fireEvent.click(await screen.findByRole('button', { name: '문서 → API 생성' }))
    expect(setHubFeature).not.toHaveBeenCalled()
    // 무엇이 열리는지(공개 + 외부 비용)와 되돌리는 법(비밀번호)이 확인창에 함께 있어야 한다.
    expect(screen.getByText('공개 허브에 보호가 필요한 모듈을 켭니다')).toBeTruthy()
    expect(within(screen.getByRole('dialog')).getByText(/외부 서비스 비용이 청구/)).toBeTruthy()
    expect(within(screen.getByRole('dialog')).getByText(/비밀번호를 걸면 닫힙니다/)).toBeTruthy()
  })

  it('확인하면 켠다', async () => {
    setHubFeature.mockResolvedValue({})
    renderAdmin(publicHub)
    fireEvent.click(await screen.findByRole('button', { name: '문서 → API 생성' }))
    fireEvent.click(screen.getByRole('button', { name: /계속/ }))
    await waitFor(() => expect(setHubFeature).toHaveBeenCalledWith('delivery', 'doc-to-api', { enabled: true }, 'pw'))
  })

  it('잠긴 허브에서는 묻지 않고 바로 켠다 — 비용이 아무에게나 열리지 않는다', async () => {
    setHubFeature.mockResolvedValue({})
    renderAdmin(lockedHub)
    fireEvent.click(await screen.findByRole('button', { name: '문서 → API 생성' }))
    await waitFor(() => expect(setHubFeature).toHaveBeenCalledWith('cs', 'doc-to-api', { enabled: true }, 'pw'))
  })

  it('비밀번호 필요 모듈(grafana-reports)도 공개 허브에서는 이유와 함께 묻는다', async () => {
    renderAdmin(publicHub)
    fireEvent.click(await screen.findByRole('button', { name: 'Grafana 리포트' }))
    expect(setHubFeature).not.toHaveBeenCalled()
    expect(within(screen.getByRole('dialog')).getByText(/서버 지표·접속 정보/)).toBeTruthy()
  })

  // 2026-11-09: 챗봇 목록이 드러나는 chatbot-monitoring도 L2 — 공개 허브에 켜기 전에 묻는다.
  it('L2 모듈(chatbot-monitoring)도 공개 허브에 켜기 전에 묻는다', async () => {
    renderAdmin(publicHub)
    fireEvent.click(await screen.findByRole('button', { name: '챗봇 모니터링' }))
    expect(setHubFeature).not.toHaveBeenCalled()
    expect(within(screen.getByRole('dialog')).getByText(/챗봇 목록/)).toBeTruthy()
  })

  // L2 미만(비밀번호 불필요) 모듈은 공개 허브라도 묻지 않는다 — sheet-to-schema는 L0.
  it('비밀번호가 필요 없는 모듈은 공개 허브라도 묻지 않는다', async () => {
    setHubFeature.mockResolvedValue({})
    renderAdmin(publicHub)
    fireEvent.click(await screen.findByRole('button', { name: '엑셀 → 스키마 변환' }))
    await waitFor(() => expect(setHubFeature).toHaveBeenCalledWith('delivery', 'sheet-to-schema', { enabled: true }, 'pw'))
  })
})

// 갈래 3: 이미 잠긴 허브의 비밀번호를 **해제**하는 것도 그 허브를 공개로 만드는 일이다.
// 비용 모듈이 켜져 있으면 그 순간 무인증 청구 경로가 열린다.
describe('비밀번호 해제', () => {
  const lockedWithCostModule = [{
    hub: { id: 'c-id', key: 'cs', name: 'CS', enabled: true, has_password: true },
    features: [{ key: 'doc-to-api', summary: {}, items: [] }],
  }]
  const lockedNoCostModule = [{
    hub: { id: 'c-id', key: 'cs', name: 'CS', enabled: true, has_password: true },
    features: [{ key: 'sheet-to-schema', summary: {}, items: [] }],
  }]

  async function openPasswordModalAndClear() {
    fireEvent.click(await screen.findByRole('button', { name: /CS 비밀번호/ }))
    fireEvent.click(screen.getByRole('button', { name: '해제' }))
  }

  it('비용 모듈이 켜져 있으면 바로 해제하지 않고 확인을 묻는다', async () => {
    renderAdmin(lockedWithCostModule)
    await openPasswordModalAndClear()
    expect(setHubPassword).not.toHaveBeenCalled()
    expect(screen.getByText('비밀번호를 해제하면 공개됩니다')).toBeTruthy()
  })

  it('확인하면 해제한다', async () => {
    setHubPassword.mockResolvedValue({})
    renderAdmin(lockedWithCostModule)
    await openPasswordModalAndClear()
    fireEvent.click(screen.getByRole('button', { name: /계속/ }))
    await waitFor(() => expect(setHubPassword).toHaveBeenCalledWith('c-id', '', 'pw'))
  })

  it('grafana-reports가 켜져 있어도 해제 전에 묻는다', async () => {
    renderAdmin([{ ...lockedNoCostModule[0], features: [{ key: 'grafana-reports', summary: {}, items: [] }] }])
    await openPasswordModalAndClear()
    expect(setHubPassword).not.toHaveBeenCalled()
    expect(within(screen.getByRole('dialog', { name: '비밀번호를 해제하면 공개됩니다' })).getByText(/서버 지표·접속 정보/)).toBeTruthy()
  })

  it('L2 이상 모듈이 없으면 묻지 않고 해제한다', async () => {
    setHubPassword.mockResolvedValue({})
    renderAdmin(lockedNoCostModule)
    await openPasswordModalAndClear()
    await waitFor(() => expect(setHubPassword).toHaveBeenCalledWith('c-id', '', 'pw'))
  })
})


// 2026-11-09·10 QA F4 — 좁은 폭에서 허브 이름이 "D.."로 잘리는데 전체 이름을 볼 방법이 없었다.
describe('허브 카드 이름', () => {
  it('잘려도 title로 전체 이름과 key를 볼 수 있다', async () => {
    renderAdmin([{ hub: { id: 'd-id', key: 'delivery', name: 'Delivery', enabled: true, has_password: true }, features: [] }])
    const name = await screen.findByText('Delivery', { selector: '.hub-name' })
    expect(name).toHaveAttribute('title', 'Delivery (delivery)')
  })
})
