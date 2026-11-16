// src/App.test.jsx — 인증 경계 계약.
//
// 규약: 비밀번호는 **플랫폼 진입점**(허브 목록 `/` · 백오피스 `/admin`)만 지킨다.
// 개별 허브(/hub/:hubKey)는 로그인 없이 들어간다.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// 각 페이지는 자기 데이터 로딩을 하므로, 라우팅만 보기 위해 표식으로 바꿔 끼운다.
vi.mock('./pages/HubsLandingPage.jsx', () => ({ default: () => <div>LANDING</div> }))
vi.mock('./pages/AdminPage.jsx', () => ({ default: () => <div>ADMIN</div> }))
vi.mock('./pages/HubPage.jsx', async () => {
  const { useParams } = await import('react-router-dom')
  const HubMock = () => <><div>HUB</div><div>key:{useParams().hubKey}</div></>
  return { default: HubMock }
})
vi.mock('./pages/LoginPage.jsx', () => ({ default: () => <div>LOGIN</div> }))
vi.mock('./components/shared/AppLayout.jsx', async () => {
  const { Outlet } = await import('react-router-dom')
  return { default: () => <Outlet /> }
})

const mockGetCookie = vi.hoisted(() => vi.fn())
vi.mock('./lib/auth.js', () => ({ getCookie: mockGetCookie, clearCookie: vi.fn() }))
const mockTeamHub = vi.hoisted(() => vi.fn(() => null))
vi.mock('./lib/teamHub.js', () => ({ teamHub: mockTeamHub }))

import { AppRoutes } from './App.jsx'

const at = (path) => render(<MemoryRouter initialEntries={[path]}><AppRoutes /></MemoryRouter>)

beforeEach(() => { vi.clearAllMocks(); mockTeamHub.mockReturnValue(null) })

describe('로그인하지 않은 방문자', () => {
  beforeEach(() => { mockGetCookie.mockReturnValue('') })

  it('허브는 비밀번호 없이 들어간다', async () => {
    at('/hub/cs')
    await waitFor(() => expect(screen.getByText('HUB')).toBeInTheDocument())
  })

  it('허브 안의 모듈 페이지도 비밀번호 없이 들어간다', async () => {
    at('/hub/cs/chatbot-monitoring')
    await waitFor(() => expect(screen.getByText('HUB')).toBeInTheDocument())
  })

  it('허브 목록(`/`)은 로그인으로 보낸다', async () => {
    at('/')
    await waitFor(() => expect(screen.getByText('LOGIN')).toBeInTheDocument())
    expect(screen.queryByText('LANDING')).not.toBeInTheDocument()
  })

  it('백오피스(`/admin`)는 로그인으로 보낸다', async () => {
    at('/admin')
    await waitFor(() => expect(screen.getByText('LOGIN')).toBeInTheDocument())
    expect(screen.queryByText('ADMIN')).not.toBeInTheDocument()
  })
})

describe('로그인한 사용자', () => {
  beforeEach(() => { mockGetCookie.mockReturnValue('pw') })

  it('허브 목록에 들어간다', async () => {
    at('/')
    await waitFor(() => expect(screen.getByText('LANDING')).toBeInTheDocument())
  })

  it('백오피스에 들어간다', async () => {
    at('/admin')
    await waitFor(() => expect(screen.getByText('ADMIN')).toBeInTheDocument())
  })
})

// 팀 주소(cs.smarthub.example.com 등)로 들어온 화면 — 서버가 index.html에 심은 표식(lib/teamHub.js)으로 그 허브에 갇힌다.
// 진짜 경계는 서버(teamHost.js)이고, 여기는 팀원이 막힌 화면을 볼 일이 없게 하는 길 안내다.
describe('팀 주소', () => {
  beforeEach(() => { mockTeamHub.mockReturnValue('cs'); mockGetCookie.mockReturnValue('pw') })

  it('첫 화면은 팀 허브로 보낸다 — 로그인해 있어도 허브 목록은 없다', async () => {
    at('/')
    await waitFor(() => expect(screen.getByText('key:cs')).toBeInTheDocument())
    expect(screen.queryByText('LANDING')).not.toBeInTheDocument()
  })

  it('자기 허브와 그 모듈 페이지는 그대로', async () => {
    at('/hub/cs/chatbot-monitoring')
    await waitFor(() => expect(screen.getByText('key:cs')).toBeInTheDocument())
  })

  it('다른 팀 허브 주소는 자기 허브로 돌린다', async () => {
    at('/hub/delivery')
    await waitFor(() => expect(screen.getByText('key:cs')).toBeInTheDocument())
  })

  it('백오피스·로그인은 열지 않고 안내만 — 허브로 돌리지 않아 401 → /login 되돌이가 생기지 않는다', async () => {
    for (const path of ['/admin', '/login']) {
      const { unmount } = at(path)
      await waitFor(() => expect(screen.getByText('이 주소에서는 열 수 없는 화면입니다.')).toBeInTheDocument())
      expect(screen.queryByText('ADMIN')).not.toBeInTheDocument()
      expect(screen.queryByText('LOGIN')).not.toBeInTheDocument()
      expect(screen.getByRole('link', { name: /허브로 가기/ })).toHaveAttribute('href', '/hub/cs')
      unmount()
    }
  })
})
