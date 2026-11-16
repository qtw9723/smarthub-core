import { useNavigate, useLocation } from 'react-router-dom'
import { Home, LayoutGrid, LogOut, Hexagon } from 'lucide-react'
import { clearCookie, getCookie } from '../../lib/auth.js'

// 플랫폼(허브 목록·백오피스) 레일
const PLATFORM_TOOLS = [
  { path: '/', icon: Home, label: '허브 목록' },
  { path: '/admin', icon: LayoutGrid, label: '백오피스' },
]

export default function IconRail() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const handleLogout = () => { clearCookie(); navigate('/login') }
  const loggedIn = !!getCookie()

  // 허브 안(/hub/:hubKey/…)에서는 그 허브에 갇힌 단방향 레일:
  // 홈은 그 허브의 툴 그리드(/hub/:hubKey)로만 — 허브 목록·백오피스로 나가는 링크 없음.
  const hubMatch = pathname.match(/^\/hub\/([^/]+)/)
  const inHub = !!hubMatch
  const tools = inHub
    ? [{ path: `/hub/${hubMatch[1]}`, icon: Home, label: '이 허브 홈' }]
    : PLATFORM_TOOLS
  const homePath = inHub ? `/hub/${hubMatch[1]}` : '/'

  return (
    <nav className="icon-rail" aria-label="탐색">
      <button className="rail-logo" onClick={() => navigate(homePath)} aria-label="홈" title={inHub ? '이 허브 홈' : 'SmartHub'}>
        <Hexagon size={20} />
      </button>
      <div className="rail-tools">
        {tools.map(({ path, icon, label }) => {
          const Icon = icon
          return (
            <button
              key={path}
              className={`rail-item${pathname === path ? ' active' : ''}`}
              onClick={() => navigate(path)}
              aria-label={label}
              title={label}
              aria-current={pathname === path ? 'page' : undefined}
            >
              <Icon size={18} />
            </button>
          )
        })}
      </div>
      {/* 허브는 로그인 없이 들어올 수 있다 — 세션이 없으면 로그아웃 버튼도 두지 않는다. */}
      {loggedIn && (
        <button className="rail-item rail-logout" onClick={handleLogout} aria-label="로그아웃" title="로그아웃">
          <LogOut size={17} />
        </button>
      )}
    </nav>
  )
}
