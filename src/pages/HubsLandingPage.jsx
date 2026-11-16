// src/pages/HubsLandingPage.jsx — 허브 목록을 링크 카드로 (허브 = 링크 진입)
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { LayoutGrid, ExternalLink } from 'lucide-react'
import { getHubs } from '../lib/api/admin.js'
import { getCookie, clearCookie } from '../lib/auth.js'
import { hubExternalUrl } from '../lib/hubLinks.js'

export default function HubsLandingPage() {
  const navigate = useNavigate()
  const [hubs, setHubs] = useState(null)

  useEffect(() => {
    getHubs(getCookie())
      .then(list => setHubs(list.filter(h => h.enabled)))
      .catch(e => { if (e.message === 'UNAUTHORIZED') { clearCookie(); navigate('/login') } })
  }, [navigate])

  return (
    <div className="hub-wrapper">
      <header className="hub-header"><span className="hub-title">SmartHub</span></header>
      <main className="hub-main">
        <p className="hub-subtitle">어느 팀 허브로 갈까요?</p>
        <div className="hub-grid">
          {(hubs ?? []).map(h => {
            const ext = hubExternalUrl(h.key)
            if (ext) {
              // 기존(외부) 앱으로 진입 — 단방향. 같은 탭으로 이동해 그 앱을 그대로 사용.
              return (
                <a key={h.id} className="hub-card" href={ext}>
                  <span className="hub-card-icon">🗂️</span>
                  <span className="hub-card-name">{h.name}</span>
                  <span className="hub-card-desc">기존 앱 열기 <ExternalLink size={11} /></span>
                </a>
              )
            }
            return (
              <button key={h.id} className="hub-card" onClick={() => navigate(`/hub/${h.key}`)}>
                <span className="hub-card-icon">🗂️</span>
                <span className="hub-card-name">{h.name}</span>
                <span className="hub-card-desc">/hub/{h.key}</span>
              </button>
            )
          })}
          <button className="hub-card" onClick={() => navigate('/admin')}>
            <span className="hub-card-icon"><LayoutGrid size={22} /></span>
            <span className="hub-card-name">백오피스</span>
            <span className="hub-card-desc">전체 허브 관망</span>
          </button>
        </div>
      </main>
    </div>
  )
}
