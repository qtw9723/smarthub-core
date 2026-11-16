// src/App.jsx
import { BrowserRouter, Routes, Route, Navigate, Link, useParams } from 'react-router-dom'
import LoginPage from './pages/LoginPage.jsx'
import HubsLandingPage from './pages/HubsLandingPage.jsx'
import HubPage from './pages/HubPage.jsx'
import AdminPage from './pages/AdminPage.jsx'
import ProtectedRoute from './components/shared/ProtectedRoute.jsx'
import AppLayout from './components/shared/AppLayout.jsx'
import { teamHub } from './lib/teamHub.js'

// 팀 주소에서 백오피스·로그인 등 다른 화면을 열면 — 허브로 돌리지 않고 안내만 한다.
// (모듈이 401에 /login으로 보내므로, 허브로 돌리면 401 → /login → 허브 → 401 되돌이가 생길 수 있다)
function TeamOnlyNotice({ hubKey }) {
  return (
    <div className="hub-wrapper">
      <main className="hub-main">
        <p className="hub-subtitle">이 주소에서는 열 수 없는 화면입니다.</p>
        <Link className="app-new-btn" to={`/hub/${hubKey}`}>허브로 가기</Link>
      </main>
    </div>
  )
}

// 다른 팀 허브 주소는 자기 허브로 — 서버도 다른 허브 API를 404로 막는다(server/lib/teamHost.js).
function OwnHubOnly({ hubKey, children }) {
  return useParams().hubKey === hubKey ? children : <Navigate to={`/hub/${hubKey}`} replace />
}

// 팀 주소의 라우트 표: 자기 허브만. 진짜 경계는 서버이고 이건 길 안내다.
function TeamRoutes({ hubKey }) {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/hub/:hubKey" element={<OwnHubOnly hubKey={hubKey}><HubPage /></OwnHubOnly>} />
        <Route path="/hub/:hubKey/:featureKey" element={<OwnHubOnly hubKey={hubKey}><HubPage /></OwnHubOnly>} />
      </Route>
      <Route path="/" element={<Navigate to={`/hub/${hubKey}`} replace />} />
      <Route path="*" element={<TeamOnlyNotice hubKey={hubKey} />} />
    </Routes>
  )
}

// 라우터 없이 라우트 표만 — App.test.jsx가 MemoryRouter로 감싸 인증 경계를 검증한다.
export function AppRoutes() {
  const team = teamHub()
  if (team) return <TeamRoutes hubKey={team} />
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* 인증 경계: 비밀번호는 **플랫폼 진입점**만 지킨다 — 허브 목록(`/`)과
          백오피스(`/admin`). 개별 허브(/hub/:hubKey)는 링크를 아는 사람이 로그인 없이
          들어간다. 서버도 같은 선을 긋는다: /api/admin/* 만 인증, /api/hubs·/api/modules/* 는 공개. */}
      <Route element={<AppLayout />}>
        <Route path="/" element={<ProtectedRoute><HubsLandingPage /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
        <Route path="/hub/:hubKey" element={<HubPage />} />
        <Route path="/hub/:hubKey/:featureKey" element={<HubPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
