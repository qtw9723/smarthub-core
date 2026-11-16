// grafana-reports 모듈 — 완결된 풀 페이지. 상단 환경(소스) 선택기 + 탭(리포트/로그 유형/설정).
// 한 허브가 여러 Grafana 환경을 독립 모니터링 — 선택된 환경(source)으로 모든 탭이 스코프된다.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { getReport, getSources, createSource } from '../../lib/api/grafana.js'
import { getCookie, clearCookie } from '../../lib/auth.js'
import { fmtKst } from '../../lib/datetime.js'
import AppHeader from '../../components/shared/AppHeader.jsx'
import AiSummary from './AiSummary.jsx'
import LogTypesTab from './LogTypesTab.jsx'
import SettingsPanel from './SettingsPanel.jsx'
import AddEnvForm from './AddEnvForm.jsx'

// 앱별 ERROR 로그 그룹. 행 클릭 시 전문 펼침/접기.
function LogGroup({ group }) {
  const [expanded, setExpanded] = useState(null)
  return (
    <div className="grafana-log-group">
      <div className={`grafana-log-head ${group.error ? 'na' : group.count ? 'warn' : 'ok'}`}>
        <strong>{group.app}</strong> · {group.error ? group.error : `${group.count}건`}
      </div>
      {!group.error && group.count > 0 && (
        <table className="grafana-log-table">
          <tbody>
            {group.rows.slice(0, 5).map((r, i) => (
              <tr
                key={i}
                className={expanded === i ? 'expanded' : ''}
                onClick={() => setExpanded(expanded === i ? null : i)}
                title={expanded === i ? '접기' : '전문 보기'}
              >
                <td className="grafana-log-time mono">{r.time}</td>
                <td className="grafana-log-msg">{expanded === i ? r.msg : r.msg.slice(0, 180)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// 상단 환경 선택기: 소스 pill들 + "＋ 환경".
function EnvBar({ sources, sourceId, onSelect, onAdd }) {
  return (
    <div className="gr-env-bar">
      <span className="gr-env-label">환경</span>
      {sources.map((s) => (
        <button
          key={s.id}
          className={`gr-env-pill${s.id === sourceId ? ' active' : ''}`}
          onClick={() => onSelect(s.id)}
          aria-current={s.id === sourceId ? 'true' : undefined}
        >
          {s.name}
        </button>
      ))}
      <button className="gr-env-add" onClick={onAdd} aria-label="환경 추가" title="환경 추가"><Plus size={16} /></button>
    </div>
  )
}

export default function HubPanel({ hubKey }) {
  const navigate = useNavigate()
  const password = getCookie()
  const [tab, setTab] = useState('report')
  const [sources, setSources] = useState([])
  const [sourceId, setSourceId] = useState(null)
  const [adding, setAdding] = useState(false)
  const [creatingEnv, setCreatingEnv] = useState(false)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const onAuthErr = useCallback((e) => {
    if (e.message === 'UNAUTHORIZED') { clearCookie(); navigate('/login'); return true }
    return false
  }, [navigate])

  // 환경 목록 로드. 선택된 소스가 목록에 없으면 첫 소스로.
  const loadSources = useCallback(async () => {
    try {
      const list = await getSources(password, hubKey)
      setSources(list)
      setSourceId((cur) => (cur && list.some((s) => s.id === cur) ? cur : (list[0]?.id ?? null)))
    } catch (e) {
      if (!onAuthErr(e)) setError('환경 목록을 불러오지 못했습니다.')
    }
  }, [password, hubKey, onAuthErr])

  useEffect(() => { loadSources() }, [loadSources])

  const load = useCallback(async () => {
    if (!sourceId) return
    setLoading(true)
    setError('')
    try {
      setReport(await getReport(password, hubKey, sourceId))
    } catch (e) {
      if (!onAuthErr(e)) setError('리포트 조회에 실패했습니다. (Grafana 연결/설정 확인)')
    } finally {
      setLoading(false)
    }
  }, [password, hubKey, sourceId, onAuthErr])

  // 리포트 탭이면서 소스가 정해졌을 때 (재)조회. 환경 전환 시 자동 재조회.
  useEffect(() => { if (tab === 'report' && sourceId) load() }, [tab, sourceId, load])

  const handleSelect = (id) => { setReport(null); setSourceId(id) }

  const handleCreateEnv = async (fields) => {
    setCreatingEnv(true)
    try {
      const created = await createSource(fields, password, hubKey)
      await loadSources()
      setSourceId(created.id)
      setReport(null)
      setAdding(false)
      toast.success(`환경 "${created.name}"을(를) 추가했습니다`)
    } catch (e) {
      if (!onAuthErr(e)) toast.error('환경 추가에 실패했습니다.')
    } finally {
      setCreatingEnv(false)
    }
  }

  // 소스가 삭제/이름변경되면 목록 갱신. 삭제 시 선택 소스가 사라지면 loadSources가 첫 소스로 옮김.
  const handleSourcesChanged = useCallback(async (deletedId) => {
    if (deletedId && deletedId === sourceId) setSourceId(null)
    await loadSources()
    setReport(null)
  }, [sourceId, loadSources])

  const alerts = report?.summary?.alerts ?? 0

  return (
    <div className="app">
      <AppHeader toolName="Grafana 리포트">
        {tab === 'report' && (
          <button className="app-new-btn" onClick={load} disabled={loading || !sourceId}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} /> 새로고침
          </button>
        )}
      </AppHeader>

      <EnvBar sources={sources} sourceId={sourceId} onSelect={handleSelect} onAdd={() => setAdding((v) => !v)} />
      {adding && <AddEnvForm onCreate={handleCreateEnv} onCancel={() => setAdding(false)} busy={creatingEnv} />}

      <nav className="nav-tabs">
        <button className={`nav-tab${tab === 'report' ? ' active' : ''}`} onClick={() => setTab('report')}>리포트</button>
        <button className={`nav-tab${tab === 'logtypes' ? ' active' : ''}`} onClick={() => setTab('logtypes')}>로그 유형</button>
        <button className={`nav-tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>설정</button>
      </nav>

      <div className="grafana-wrap">
        {!sourceId ? (
          <p className="job-empty">환경이 없습니다. 상단의 ＋로 환경을 추가하세요.</p>
        ) : tab === 'settings' ? (
          <SettingsPanel hubKey={hubKey} source={sourceId} sources={sources} onSourcesChanged={handleSourcesChanged} />
        ) : tab === 'logtypes' ? (
          <LogTypesTab hubKey={hubKey} source={sourceId} />
        ) : (
          <>
            {error && <div className="grafana-error">{error}</div>}
            {loading && !report && <p className="job-empty">조회 중…</p>}
            {report && (
              <>
                <div className={`grafana-summary ${report.summary.status}`}>
                  <span className={`status-dot ${alerts ? 'fail' : 'ok'}`} />
                  {alerts ? `이상 ${alerts}건 — 점검 필요` : '모두 정상입니다'}
                  <span className="grafana-time mono">{fmtKst(report.generatedAt)} (KST)</span>
                </div>

                <AiSummary analysis={report.analysis} password={password} hubKey={hubKey} source={sourceId} />

                <section className="grafana-section">
                  <h3 className="grafana-section-title">리소스 사용량</h3>
                  <div className="grafana-cards">
                    {report.metrics.map((m) => (
                      <div key={m.label} className={`grafana-card ${m.error ? 'na' : m.over ? 'warn' : 'ok'}`}>
                        <span className="grafana-card-label">{m.label}</span>
                        <span className="grafana-card-value mono">
                          {m.error ? m.error : (m.value == null ? '데이터 없음' : (typeof m.value === 'number' ? m.value.toFixed(1) : m.value))}
                        </span>
                        <span className="grafana-card-threshold">임계 {m.threshold}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="grafana-section">
                  <h3 className="grafana-section-title">ERROR 로그 (앱별, 24h)</h3>
                  {report.logs.map((g) => <LogGroup key={g.app} group={g} />)}
                </section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
