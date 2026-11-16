// src/pages/LoginPage.jsx
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAdminModules } from '../lib/api/admin.js'
import { setCookie, getCookie } from '../lib/auth.js'

export default function LoginPage() {
  const [pwInput, setPwInput] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (getCookie()) navigate('/', { replace: true })
  }, [navigate])

  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // 비밀번호 검증은 **인증이 남아 있는 유일한 표면**인 어드민 API로 한다.
      // (모듈 API는 이제 공개라 401을 내지 않으므로 검증에 쓸 수 없다.)
      // /api/admin/modules는 DB를 타지 않는 레지스트리 조회라 가장 싸고 부작용이 없다.
      await getAdminModules(pwInput)
      setCookie(pwInput)
      navigate('/')
    } catch (err) {
      if (err.message === 'UNAUTHORIZED') setError('비밀번호가 틀렸습니다.')
      else if (err.message === 'TOO_MANY_ATTEMPTS') setError(`시도가 너무 많습니다. ${err.retryAfterMinutes ?? 15}분 뒤에 다시 시도해 주세요.`)
      else setError('연결 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="gate-wrapper">
      <div className="gate-card">
        <h1 className="gate-title">SmartHub</h1>
        <p className="gate-subtitle">팀 업무 자동화 통합 플랫폼</p>
        <form onSubmit={handleLogin}>
          <input
            className={`gate-input${error ? ' gate-input-error' : ''}`}
            type="password"
            value={pwInput}
            onChange={e => setPwInput(e.target.value)}
            placeholder="비밀번호"
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
