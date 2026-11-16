// 백오피스 비용 위험 경고 — "공개 허브 + 외부 비용 모듈 켜짐"이 눈에 띄는가.
//
// 판정 자체는 src/lib/securityPolicy.test.js가 고정한다. 여기서는 그 판정이 실제로 화면에
// 드러나는지만 본다 — 잠그는 것을 잊는 사고를 막는 것이 이 경고의 존재 이유이므로,
// 조용히 사라지면 기능이 없는 것과 같다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/api/admin.js', () => ({
  getOverview: vi.fn(), getActivity: vi.fn(), createHub: vi.fn(),
  updateHub: vi.fn(), deleteHub: vi.fn(), setHubFeature: vi.fn(), setHubPassword: vi.fn(),
  getSecurity: vi.fn(), setModuleSecurity: vi.fn(), setHubSecurityAck: vi.fn(),
}))
vi.mock('../lib/auth.js', () => ({ getCookie: () => 'pw', clearCookie: vi.fn() }))

import AdminPage from './AdminPage.jsx'
import { getOverview, getActivity, getSecurity, setHubSecurityAck, setModuleSecurity } from '../lib/api/admin.js'

function hubEntry({ key, name, has_password, featureKeys, security_ack_level = null }) {
  return {
    hub: { id: `${key}-id`, key, name, enabled: true, has_password, security_ack_level },
    features: featureKeys.map(k => ({ key: k, summary: {}, items: [] })),
  }
}

function renderAdmin(entries, security = { modules: [] }) {
  getOverview.mockResolvedValue(entries)
  if (security instanceof Error) getSecurity.mockRejectedValue(security)
  else getSecurity.mockResolvedValue(security)
  getActivity.mockResolvedValue({ events: [], automations: [] })
  return render(<MemoryRouter><AdminPage /></MemoryRouter>)
}

beforeEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); sessionStorage.clear() })

describe('공개 허브에서 비용 모듈이 켜져 있으면', () => {
  it('grafana-reports(비밀번호 필요 모듈)도 카드 경고와 배너가 뜬다', async () => {
    renderAdmin([hubEntry({ key: 'cs', name: 'CS', has_password: false, featureKeys: ['grafana-reports'] })])
    expect(await screen.findByTestId('cost-risk-cs')).toBeTruthy()
    expect(screen.getByTestId('cost-risk-banner').textContent).toMatch(/보호가 필요한 모듈/)
  })

  it('허브 카드에 경고가 뜬다', async () => {
    renderAdmin([hubEntry({ key: 'delivery', name: 'Delivery', has_password: false, featureKeys: ['doc-to-api'] })])
    expect(await screen.findByTestId('cost-risk-delivery')).toBeTruthy()
  })

  it('상단 요약이 어느 허브인지 이름으로 알려준다', async () => {
    renderAdmin([hubEntry({ key: 'delivery', name: 'Delivery', has_password: false, featureKeys: ['doc-to-api'] })])
    const banner = await screen.findByTestId('cost-risk-banner')
    expect(banner.textContent).toContain('Delivery')
  })
})

describe('경고가 뜨지 않아야 하는 경우', () => {
  it('비밀번호가 걸린 허브', async () => {
    renderAdmin([hubEntry({ key: 'cs', name: 'CS', has_password: true, featureKeys: ['doc-to-api'] })])
    await waitFor(() => expect(screen.getByText('CS')).toBeTruthy())
    expect(screen.queryByTestId('cost-risk-cs')).toBeNull()
    expect(screen.queryByTestId('cost-risk-banner')).toBeNull()
  })

  // chatbot-monitoring은 이제 L2(챗봇 목록) — 조용해야 하는 경우는 L0 모듈만 켜진 공개 허브다.
  it('공개 허브지만 L0 모듈만 켜져 있음', async () => {
    renderAdmin([hubEntry({ key: 'delivery', name: 'Delivery', has_password: false, featureKeys: ['sheet-to-schema'] })])
    await waitFor(() => expect(screen.getByText('Delivery')).toBeTruthy())
    expect(screen.queryByTestId('cost-risk-delivery')).toBeNull()
    expect(screen.queryByTestId('cost-risk-banner')).toBeNull()
  })
})

// 실제로 한 번 놓쳤던 seam: 위험 강조 규칙을 .modchip.on보다 **앞**에 두면 특이도가 같아
// 나중 규칙(.on)이 이겨서 빨강이 사라진다. 빌드도 테스트도 통과하는데 화면에서만
// 조용히 안 보인다 — 순서를 테스트로 고정한다.
describe('위험 강조 CSS 우선순위', () => {
  it('.modchip.risk 규칙이 .modchip.on 뒤에 온다', () => {
    // jsdom 환경에서 import.meta.url은 file: 스킴이 아니다 — 저장소 루트 기준 경로로 읽는다.
    const css = readFileSync('src/index.css', 'utf8')
    expect(css.indexOf('.bo .modchip.risk')).toBeGreaterThan(css.indexOf('.bo .modchip.on'))
  })
})


// 2026-11-09 모듈 보안 레벨 — 실효 레벨(서버) 판정 · 진입 팝업 · 확인된 예외.
// 판정 함수는 src/lib/securityPolicy.test.js가 고정한다. 여기서는 화면에 드러나는지 본다.
describe('보안 정책 위반 팝업', () => {
  const openCs = (extra = {}) => hubEntry({ key: 'cs', name: 'CS', has_password: false, featureKeys: ['grafana-reports', 'chatbot-monitoring'], ...extra })

  it('들어올 때 위반 허브와 걸린 모듈을 팝업으로 알린다', async () => {
    renderAdmin([openCs()])
    const dialog = await screen.findByRole('dialog', { name: /보안 정책/ })
    expect(dialog.textContent).toContain('CS')
    expect(dialog.textContent).toContain('Grafana 리포트')
    expect(screen.getByTestId('cost-risk-banner')).toBeTruthy()
    expect(screen.getByTestId('cost-risk-cs')).toBeTruthy()
  })

  it('"확인함"을 누르면 예외로 기록되고 배너에서 빠져 회색 예외로 남는다', async () => {
    // 실제 서버처럼: 저장 뒤 다시 읽으면 예외가 반영돼 있다.
    setHubSecurityAck.mockImplementation(async () => { getOverview.mockResolvedValue([openCs({ security_ack_level: 'L2' })]) })
    renderAdmin([openCs()])
    const dialog = await screen.findByRole('dialog', { name: /보안 정책/ })
    fireEvent.click(within(dialog).getByRole('button', { name: /확인함/ }))
    await waitFor(() => expect(setHubSecurityAck).toHaveBeenCalledWith('cs-id', 'L2', 'pw'))
    await waitFor(() => expect(screen.queryByTestId('cost-risk-banner')).toBeNull())
    expect(screen.getByTestId('security-ack-cs').textContent).toMatch(/확인된 예외/)
    expect(screen.queryByTestId('cost-risk-cs')).toBeNull()
  })

  // 리뷰 지적: 팝업 안에서 모두 "확인함"하면 목록만 비고 팝업 상태가 남아, 같은 세션에서 새 위반이 생길 때
  // 진입 팝업이 다시 떴다. 다 처리하면 닫고 본 것으로 기록한다.
  it('팝업에서 모두 확인하면 닫히고 이번 세션에 본 것으로 남는다', async () => {
    // 실제 서버처럼: 저장 뒤 다시 읽으면 예외가 반영돼 있다.
    setHubSecurityAck.mockImplementation(async () => { getOverview.mockResolvedValue([openCs({ security_ack_level: 'L2' })]) })
    renderAdmin([openCs()])
    const dialog = await screen.findByRole('dialog', { name: /보안 정책/ })
    fireEvent.click(within(dialog).getByRole('button', { name: /확인함/ }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(sessionStorage.getItem('smarthub.securityPopupSeen')).toBe('1')
  })

  // 리뷰 지적: 진행 중이던 60초 갱신 응답이 로컬 예외 표시를 덮어쓸 수 있다 — 저장 뒤 다시 읽는다.
  it('확인함 저장 뒤 허브 현황을 다시 읽는다', async () => {
    // 실제 서버처럼: 저장 뒤 다시 읽으면 예외가 반영돼 있다.
    setHubSecurityAck.mockImplementation(async () => { getOverview.mockResolvedValue([openCs({ security_ack_level: 'L2' })]) })
    renderAdmin([openCs()])
    const dialog = await screen.findByRole('dialog', { name: /보안 정책/ })
    const before = getOverview.mock.calls.length
    fireEvent.click(within(dialog).getByRole('button', { name: /확인함/ }))
    await waitFor(() => expect(getOverview.mock.calls.length).toBeGreaterThan(before))
  })

  it('확인 시점 레벨 그대로면 팝업도 배너도 없이 회색 예외', async () => {
    renderAdmin([openCs({ security_ack_level: 'L2' })])
    expect(await screen.findByTestId('security-ack-cs')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByTestId('cost-risk-banner')).toBeNull()
  })

  it('예외 뒤 L3 모듈(mailer)이 켜져 있으면 예외가 풀려 다시 경고한다', async () => {
    renderAdmin([hubEntry({ key: 'cs', name: 'CS', has_password: false, featureKeys: ['grafana-reports', 'mailer'], security_ack_level: 'L2' })])
    expect(await screen.findByRole('dialog', { name: /보안 정책/ })).toBeTruthy()
    expect(screen.getByTestId('cost-risk-banner')).toBeTruthy()
    expect(screen.queryByTestId('security-ack-cs')).toBeNull()
  })

  it('닫으면 같은 세션에서는 다시 띄우지 않는다', async () => {
    const { unmount } = renderAdmin([openCs()])
    const dialog = await screen.findByRole('dialog', { name: /보안 정책/ })
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    unmount()
    renderAdmin([openCs()])
    await screen.findByTestId('cost-risk-cs')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sessionStorage가 막힌 브라우저에서도 팝업은 뜨고 화면은 깨지지 않는다', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    renderAdmin([openCs()])
    const dialog = await screen.findByRole('dialog', { name: /보안 정책/ })
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('실효 레벨', () => {
  it('레벨을 못 불러오면 기본값으로 경고하고 그 사실을 알린다', async () => {
    renderAdmin([hubEntry({ key: 'cs', name: 'CS', has_password: false, featureKeys: ['grafana-reports'] })], new Error('500'))
    expect(await screen.findByTestId('cost-risk-banner')).toBeTruthy()
    expect(screen.getByTestId('security-load-error').textContent).toMatch(/기본값으로 판정/)
  })

  it('관리자가 grafana-reports를 L1로 낮췄으면 그 모듈만 켜진 공개 허브는 조용하다', async () => {
    renderAdmin(
      [hubEntry({ key: 'cs', name: 'CS', has_password: false, featureKeys: ['grafana-reports'] })],
      { modules: [{ key: 'grafana-reports', defaultLevel: 'L2', level: 'L1', reason: '사내 테스트 봇만' }] },
    )
    await waitFor(() => expect(getSecurity).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('CS')).toBeTruthy())
    await waitFor(() => expect(screen.queryByTestId('cost-risk-cs')).toBeNull())
    expect(screen.queryByTestId('cost-risk-banner')).toBeNull()
  })
})

describe('보안 정책 영역에서 레벨 조정', () => {
  it('mailer를 사유와 함께 L1로 낮추면 mailer만 켜진 공개 허브 경고가 즉시 사라진다', async () => {
    setModuleSecurity.mockResolvedValue({ key: 'mailer', defaultLevel: 'L3', level: 'L1', reason: '사내 수신자만' })
    renderAdmin([hubEntry({ key: 'ops', name: 'Ops', has_password: false, featureKeys: ['mailer'] })], {
      modules: [{ key: 'mailer', defaultLevel: 'L3', level: 'L3', reason: null }],
    })
    const dialog = await screen.findByRole('dialog', { name: /보안 정책/ })
    fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
    expect(screen.getByTestId('cost-risk-banner')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('메일 발송 보안 레벨'), { target: { value: 'L1' } })
    fireEvent.change(screen.getByLabelText('메일 발송 조정 사유'), { target: { value: '사내 수신자만' } })
    fireEvent.click(screen.getByRole('button', { name: '메일 발송 레벨 저장' }))

    await waitFor(() => expect(setModuleSecurity).toHaveBeenCalledWith('mailer', { level: 'L1', reason: '사내 수신자만' }, 'pw'))
    await waitFor(() => expect(screen.queryByTestId('cost-risk-banner')).toBeNull())
    expect(screen.queryByTestId('cost-risk-ops')).toBeNull()
  })
})

// 리뷰 Minor 처리(2026-11-09)
describe('리뷰 후속', () => {
  it('레벨을 못 불러온 뒤 "다시 시도"로 다시 읽는다', async () => {
    getOverview.mockResolvedValue([])
    getActivity.mockResolvedValue({ events: [], automations: [] })
    getSecurity.mockRejectedValueOnce(new Error('500')).mockResolvedValue({ modules: [] })
    render(<MemoryRouter><AdminPage /></MemoryRouter>)
    const notice = await screen.findByTestId('security-load-error')
    fireEvent.click(within(notice).getByRole('button', { name: '다시 시도' }))
    await waitFor(() => expect(screen.queryByTestId('security-load-error')).toBeNull())
    expect(getSecurity).toHaveBeenCalledTimes(2)
  })

  it('확인된 예외 표시는 현재 요구 레벨을 보여 주고, 확인한 레벨은 따로 적는다', async () => {
    renderAdmin([hubEntry({ key: 'cs', name: 'CS', has_password: false, featureKeys: ['grafana-reports'], security_ack_level: 'L3' })])
    const ack = await screen.findByTestId('security-ack-cs')
    expect(ack.textContent).toMatch(/요구 L2 민감/)
    expect(ack.textContent).toMatch(/L3 제한까지 확인/)
  })
})
