// HubPage의 모듈 패널 렌더 계약 — 지연 로드 실패 격리(ErrorBoundary)와 래퍼 없는 렌더.
//
// 각 케이스는 서로 다른 module key를 쓴다: HubPage의 lazyPanelCache가 모듈 레벨 Map이라
// 같은 key를 재사용하면 앞 테스트의 lazy가 그대로 재사용돼 케이스가 오염된다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../lib/api/hubs.js', () => ({ getPublicHubFeatures: vi.fn() }))
vi.mock('../modules/index.js', () => ({ getModule: vi.fn(), getModules: vi.fn(() => []) }))

import HubPage from './HubPage.jsx'
import { getPublicHubFeatures } from '../lib/api/hubs.js'
import { getModule } from '../modules/index.js'

// 이 허브가 mod 하나만 켠 상태로 /hub/cs/<key>를 렌더한다.
function renderPanel(mod) {
  getPublicHubFeatures.mockResolvedValue({
    hub: { key: 'cs', name: 'CS' },
    features: [{ feature_key: mod.key, enabled: true, sort_order: 0 }],
  })
  getModule.mockImplementation((k) => (k === mod.key ? mod : null))
  return render(
    <MemoryRouter initialEntries={[`/hub/cs/${mod.key}`]}>
      <Routes>
        <Route path="/hub/:hubKey/:featureKey" element={<HubPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HubPage · ModulePanel', () => {
  let errSpy

  beforeEach(() => {
    // React는 경계가 잡은 오류도 console.error로 보고한다 — 테스트 출력만 조용히 한다.
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    errSpy.mockRestore()
    vi.clearAllMocks()
  })

  it('지연 로드 청크가 실패해도 폴백만 보이고 오류가 루트로 전파되지 않는다', async () => {
    // 새 버전 배포로 콘텐츠 해시 파일명이 바뀌어 청크가 404 나는 상황
    const mod = {
      key: 'test-broken-chunk',
      label: 'Broken',
      loadPanel: () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
    }

    const { container } = renderPanel(mod)

    await waitFor(() => expect(screen.getByText(/모듈을 불러오지 못했습니다/)).toBeInTheDocument())
    // 원인 설명 + 새로고침 재시도
    expect(screen.getByText(/새 버전이 배포되어/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '새로고침' })).toBeInTheDocument()
    // 트리가 언마운트되지 않았다(= 앱 전체가 빈 화면이 되지 않았다)
    expect(container.firstChild).not.toBeNull()
  })

  // 모든 모듈이 자기 완결적 풀페이지를 그린다 — HubPage는 어떤 표면 래퍼도 씌우지 않는다.
  it('지연 로드 모듈은 래퍼 없이 패널 자체가 루트로 렌더된다', async () => {
    const Panel = () => <div className="app">패널 본문</div>
    const mod = {
      key: 'test-lazy-panel',
      label: 'Lazy',
      loadPanel: async () => ({ default: Panel }),
    }

    const { container } = renderPanel(mod)

    await waitFor(() => expect(screen.getByText('패널 본문')).toBeInTheDocument())
    expect(container.querySelector('.surface-wrapper')).toBeNull()
    // 패널의 최상위 요소가 곧 렌더 트리의 루트다(중간 래퍼 div 없음).
    expect(container.firstChild).toBe(screen.getByText('패널 본문'))
  })

  it('정적 HubPanel 모듈도 래퍼 없이 렌더된다', async () => {
    const Panel = () => <div>기존 패널 본문</div>
    const mod = { key: 'test-static-panel', label: 'Plain', HubPanel: Panel }

    const { container } = renderPanel(mod)

    await waitFor(() => expect(screen.getByText('기존 패널 본문')).toBeInTheDocument())
    expect(container.querySelector('.surface-wrapper')).toBeNull()
  })
})
