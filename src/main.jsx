import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

function mount() {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// 데모 빌드(VITE_DEMO=true)는 /api/*를 브라우저 안의 가짜 백엔드가 받는다 — 실운영 아님.
if (import.meta.env.VITE_DEMO === 'true') {
  import('./demo/demoBackend.js').then((m) => { m.installDemo(); mount() })
} else {
  mount()
}
