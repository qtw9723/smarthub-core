// grafana-reports 모듈 — 환경(소스) 추가 인라인 폼. 이름 + 연결정보(비우면 ENV 폴백).
import { useState } from 'react'

export default function AddEnvForm({ onCreate, onCancel, busy }) {
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [token, setToken] = useState('')
  const [promUid, setPromUid] = useState('')
  const [esUid, setEsUid] = useState('')

  const submit = (e) => {
    e.preventDefault()
    if (!name.trim()) return
    onCreate({
      name: name.trim(),
      base_url: baseUrl.trim(),
      token: token.trim(),
      prom_uid: promUid.trim(),
      es_uid: esUid.trim(),
    })
  }

  return (
    <form className="gr-env-form" onSubmit={submit}>
      <div className="gr-env-form-row">
        <label htmlFor="env-name">환경 이름 *</label>
        <input id="env-name" className="form-input" value={name} autoFocus
          onChange={(e) => setName(e.target.value)} placeholder="예: 스테이징" />
      </div>
      <div className="gr-env-form-row">
        <label htmlFor="env-url">Grafana URL</label>
        <input id="env-url" className="form-input" value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)} placeholder="비우면 기본(ENV) 연결 사용" />
      </div>
      <div className="gr-env-form-row">
        <label htmlFor="env-token">API 토큰</label>
        <input id="env-token" className="form-input" type="password" value={token}
          onChange={(e) => setToken(e.target.value)} placeholder="비우면 기본(ENV) 토큰 사용" />
      </div>
      <div className="gr-env-form-row">
        <label htmlFor="env-prom">Prometheus UID</label>
        <input id="env-prom" className="form-input" value={promUid}
          onChange={(e) => setPromUid(e.target.value)} placeholder="데이터소스 UID (선택)" />
      </div>
      <div className="gr-env-form-row">
        <label htmlFor="env-es">Elasticsearch UID</label>
        <input id="env-es" className="form-input" value={esUid}
          onChange={(e) => setEsUid(e.target.value)} placeholder="데이터소스 UID (선택)" />
      </div>
      <p className="gr-env-hint">연결정보를 비우면 기본(운영) 연결을 그대로 씁니다. 쿼리·수신자는 추가 후 ‘설정’ 탭에서 조정하세요.</p>
      <div className="gr-env-form-actions">
        <button type="button" className="modal-cancel" onClick={onCancel} disabled={busy}>취소</button>
        <button type="submit" className="modal-submit" disabled={busy || !name.trim()}>
          {busy ? '추가 중…' : '환경 추가'}
        </button>
      </div>
    </form>
  )
}
