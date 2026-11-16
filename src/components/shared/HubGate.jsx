// src/components/shared/HubGate.jsx — 허브 잠금 화면.
//
// 플랫폼 로그인(/login)과 다른 화면이다: 여기서 푸는 것은 **이 허브 하나**이고,
// 다른 허브는 그대로 잠겨 있다. 시각적으로는 같은 .gate-* 스타일을 쓴다.
import { useState } from 'react'
import { setHubCookie } from '../../lib/auth.js'
import { getPublicHubFeatures } from '../../lib/api/hubs.js'

export default function HubGate({ hubKey, hubName, onUnlock }) {
  const [pwInput, setPwInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // 쿠키에 저장하기 전에 먼저 검증한다 — 틀린 값을 저장해두면 다음 진입 때
      // 잠금 화면이 아니라 정체불명의 401로 보인다.
      await getPublicHubFeatures(hubKey, pwInput)
      setHubCookie(hubKey, pwInput)
      onUnlock()
    } catch (err) {
      if (err.message === 'HUB_PASSWORD_REQUIRED') setError('비밀번호가 틀렸습니다.')
      else if (err.message === 'TOO_MANY_ATTEMPTS') setError(`시도가 너무 많습니다. ${err.retryAfterMinutes ?? 15}분 뒤에 다시 시도해 주세요.`)
      else setError('연결 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="gate-wrapper">
      <div className="gate-card">
        <h1 className="gate-title">{hubName ?? hubKey}</h1>
        <p className="gate-subtitle">이 허브는 비밀번호가 필요합니다</p>
        <form onSubmit={handleSubmit}>
          <input
            className={`gate-input${error ? ' gate-input-error' : ''}`}
            type="password"
            value={pwInput}
            onChange={e => setPwInput(e.target.value)}
            placeholder="허브 비밀번호"
            aria-invalid={!!error}
            autoFocus
          />
          <button className="gate-btn" type="submit" disabled={loading}>
            {loading ? '확인 중…' : '확인'}
          </button>
          {error && <p className="gate-error">{error}</p>}
        </form>
      </div>
    </div>
  )
}
