// grafana-reports 모듈 — 설정 패널(환경/소스 스코프). 연결정보 + 리포트 발송 + 모니터링 쿼리.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import TagInput from '../../components/mailer/TagInput.jsx'
import QueryListEditor from './QueryListEditor.jsx'
import ConfirmDialog from '../../components/shared/ConfirmDialog.jsx'
import { getSettings, updateSettings, testQuery, deleteSource } from '../../lib/api/grafana.js'
import { canSave } from '../../lib/grafanaQueryGate.js'
import { getCookie, clearCookie } from '../../lib/auth.js'
import { randomId } from '../../lib/uuid.js'

const METRIC_COLUMNS = [
  { key: 'label', label: '라벨' },
  { key: 'query', label: 'PromQL 쿼리', wide: true },
  { key: 'threshold', label: '임계값', type: 'number' },
]
const LOG_COLUMNS = [
  { key: 'label', label: '라벨' },
  { key: 'query', label: 'ES 쿼리', wide: true },
]
const newMetric = () => ({ _id: randomId(), label: '', query: '', threshold: 0, enabled: true })
const newLog = () => ({ _id: randomId(), label: '', query: '', enabled: true })

const attachMeta = (r) => ({ ...r, _id: randomId(), _savedQuery: r.query, _test: 'untested', _testedQuery: undefined, _testError: '' })
const stripMetric = (r) => ({ label: r.label, query: r.query, threshold: Number(r.threshold), enabled: r.enabled !== false })
const stripLog = (r) => ({ label: r.label, query: r.query, enabled: r.enabled !== false })

export default function SettingsPanel({ hubKey, source, sources = [], onSourcesChanged }) {
  const navigate = useNavigate()
  const password = getCookie()
  // 연결정보(환경)
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [promUid, setPromUid] = useState('')
  const [esUid, setEsUid] = useState('')
  const [maskedToken, setMaskedToken] = useState('') // 현재 저장된 토큰(마스킹, 읽기전용 안내)
  const [newToken, setNewToken] = useState('')        // 새로 입력한 토큰(비우면 유지)
  // 리포트 발송
  const [recipients, setRecipients] = useState([])
  const [sendHour, setSendHour] = useState(9)
  const [enabled, setEnabled] = useState(true)
  const [logLagHours, setLogLagHours] = useState(3)
  const [metrics, setMetrics] = useState([])
  const [logQueries, setLogQueries] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const s = await getSettings(password, hubKey, source)
      setName(s.name ?? '')
      setBaseUrl(s.base_url ?? '')
      setPromUid(s.prom_uid ?? '')
      setEsUid(s.es_uid ?? '')
      setMaskedToken(s.token ?? '')
      setNewToken('')
      setRecipients(s.recipients ?? [])
      setSendHour(s.send_hour ?? 9)
      setEnabled(!!s.enabled)
      setLogLagHours(s.log_lag_hours ?? 3)
      setMetrics((s.metrics ?? []).map(attachMeta))
      setLogQueries((s.log_queries ?? []).map(attachMeta))
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') { clearCookie(); navigate('/login') }
      else setError('설정을 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }, [password, hubKey, source, navigate])

  useEffect(() => { load() }, [load])

  const runMetricTest = (query) => testQuery({ type: 'metric', query }, password, hubKey, source)
  const runLogTest = (query) => testQuery({ type: 'log', query }, password, hubKey, source)

  const gateOk = canSave(metrics, logQueries)

  const handleSave = async (e) => {
    e.preventDefault()
    if (!gateOk) return
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const payload = {
        name: name.trim() || '환경',
        base_url: baseUrl.trim(), prom_uid: promUid.trim(), es_uid: esUid.trim(),
        recipients, send_hour: sendHour, enabled, log_lag_hours: logLagHours,
        metrics: metrics.map(stripMetric), log_queries: logQueries.map(stripLog),
      }
      if (newToken.trim()) payload.token = newToken.trim() // 비우면 기존 토큰 유지
      const s = await updateSettings(payload, password, hubKey, source)
      setName(s.name ?? name)
      setBaseUrl(s.base_url ?? '')
      setPromUid(s.prom_uid ?? '')
      setEsUid(s.es_uid ?? '')
      setMaskedToken(s.token ?? '')
      setNewToken('')
      setRecipients(s.recipients ?? [])
      setSendHour(s.send_hour ?? sendHour)
      setEnabled(!!s.enabled)
      setLogLagHours(s.log_lag_hours ?? logLagHours)
      setMetrics((s.metrics ?? []).map(attachMeta))
      setLogQueries((s.log_queries ?? []).map(attachMeta))
      setSaved(true)
      onSourcesChanged?.() // 이름 변경을 선택기 pill에 반영
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') { clearCookie(); navigate('/login') }
      else setError('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await deleteSource(source, password, hubKey)
      toast.success(`환경 "${name}"을(를) 삭제했습니다`)
      onSourcesChanged?.(source)
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') { clearCookie(); navigate('/login') }
      else if (/last-source/.test(e.message)) toast.error('마지막 환경은 삭제할 수 없습니다.')
      else toast.error('환경 삭제에 실패했습니다.')
    } finally {
      setConfirmDel(false)
    }
  }

  if (loading) return <p className="job-empty">불러오는 중…</p>

  return (
    <form className="gset" onSubmit={handleSave}>
      <section className="gset-section">
        <h3 className="gset-section-title">환경 연결</h3>
        <div className="gset-grid">
          <div className="gset-field">
            <label className="gset-label" htmlFor="gset-name">환경 이름</label>
            <input id="gset-name" className="form-input" value={name}
              onChange={(e) => { setName(e.target.value); setSaved(false) }} placeholder="예: 운영" />
          </div>
          <div className="gset-field">
            <label className="gset-label" htmlFor="gset-url">Grafana URL</label>
            <input id="gset-url" className="form-input" value={baseUrl}
              onChange={(e) => { setBaseUrl(e.target.value); setSaved(false) }} placeholder="비우면 기본(ENV) 연결" />
          </div>
          <div className="gset-field">
            <label className="gset-label" htmlFor="gset-token">API 토큰</label>
            <input id="gset-token" className="form-input" type="password" value={newToken}
              onChange={(e) => { setNewToken(e.target.value); setSaved(false) }}
              placeholder={maskedToken ? `현재: ${maskedToken} — 변경 시 입력` : '비우면 기본(ENV) 토큰'} />
          </div>
          <div className="gset-field">
            <label className="gset-label" htmlFor="gset-prom">Prometheus UID</label>
            <input id="gset-prom" className="form-input" value={promUid}
              onChange={(e) => { setPromUid(e.target.value); setSaved(false) }} placeholder="데이터소스 UID (선택)" />
          </div>
          <div className="gset-field">
            <label className="gset-label" htmlFor="gset-es">Elasticsearch UID</label>
            <input id="gset-es" className="form-input" value={esUid}
              onChange={(e) => { setEsUid(e.target.value); setSaved(false) }} placeholder="데이터소스 UID (선택)" />
          </div>
        </div>
        <p className="form-hint">연결정보를 비우면 기본(운영) 연결을 씁니다. 토큰은 보안상 마스킹되어 표시됩니다.</p>
      </section>

      <section className="gset-section">
        <h3 className="gset-section-title">리포트 발송</h3>
        <div className="gset-grid">
          <div className="gset-field">
            <span className="gset-label">매일 자동 발송</span>
            <label className="gset-switch">
              <input type="checkbox" checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSaved(false) }} />
              <span className="gset-switch-track"><span className="gset-switch-dot" /></span>
              <span className="gset-switch-text">{enabled ? '켜짐' : '꺼짐'}</span>
            </label>
          </div>
          <div className="gset-field">
            <label className="gset-label" htmlFor="grafana-send-hour">발송 시각 (KST)</label>
            <select id="grafana-send-hour" className="form-select" value={sendHour}
              onChange={(e) => { setSendHour(Number(e.target.value)); setSaved(false) }}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{String(h).padStart(2, '0')}시</option>
              ))}
            </select>
          </div>
          <div className="gset-field">
            <label className="gset-label" htmlFor="grafana-log-lag">로그 적재 지연 보정</label>
            <select id="grafana-log-lag" className="form-select" value={logLagHours}
              onChange={(e) => { setLogLagHours(Number(e.target.value)); setSaved(false) }}>
              {Array.from({ length: 25 }, (_, h) => (
                <option key={h} value={h}>{h}시간</option>
              ))}
            </select>
          </div>
        </div>
        <div className="gset-field gset-field-full">
          <span className="gset-label">수신자 이메일</span>
          <TagInput values={recipients} onChange={(v) => { setRecipients(v); setSaved(false) }} />
          <p className="form-hint">이메일 입력 후 Enter. 비우면 환경변수 수신자로 폴백됩니다. 발송을 완전히 멈추려면 ‘매일 자동 발송’을 꺼주세요. 로그 지연 보정 기본 3시간.</p>
        </div>
      </section>

      <section className="gset-section">
        <h3 className="gset-section-title">모니터링 쿼리</h3>

        <h4 className="gset-subtitle">메트릭 <span className="gset-subtitle-dim">(Prometheus)</span></h4>
        <QueryListEditor
          items={metrics}
          columns={METRIC_COLUMNS}
          newRow={newMetric}
          addLabel="+ 메트릭 추가"
          onChange={(v) => { setMetrics(v); setSaved(false) }}
          onTest={runMetricTest}
          formatResult={(r) => (r.value == null ? '데이터 없음' : `현재 값 ${r.value}`)}
        />

        <h4 className="gset-subtitle gset-subtitle-spaced">로그 <span className="gset-subtitle-dim">(Elasticsearch)</span></h4>
        <QueryListEditor
          items={logQueries}
          columns={LOG_COLUMNS}
          newRow={newLog}
          addLabel="+ 로그 쿼리 추가"
          onChange={(v) => { setLogQueries(v); setSaved(false) }}
          onTest={runLogTest}
          formatResult={(r) => `최근 24h(지연보정) ${r.count ?? 0}건`}
        />
      </section>

      {error && <div className="grafana-error">{error}</div>}
      <div className="gset-savebar">
        {sources.length > 1 && (
          <button type="button" className="logtype-delete" onClick={() => setConfirmDel(true)}>
            <Trash2 size={14} /> 이 환경 삭제
          </button>
        )}
        {!gateOk && <span className="form-hint form-hint-error">신규·수정된 쿼리는 테스트를 통과해야 저장할 수 있습니다.</span>}
        <button type="submit" className="modal-submit" disabled={saving || !gateOk}>
          {saving ? '저장 중…' : saved ? '저장됨 ✓' : '저장'}
        </button>
      </div>

      {confirmDel && (
        <ConfirmDialog
          title="환경 삭제"
          message={`"${name}" 환경을 삭제할까요? 이 환경의 오류 이력도 함께 삭제됩니다.`}
          confirmLabel="삭제" danger
          onConfirm={handleDelete}
          onCancel={() => setConfirmDel(false)}
        />
      )}
    </form>
  )
}
