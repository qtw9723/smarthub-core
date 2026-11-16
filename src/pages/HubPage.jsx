// src/pages/HubPage.jsx — /hub/:hubKey — 툴 그리드 랜딩 / 모듈은 각자 완결된 풀페이지로
import { useState, useEffect, useCallback, lazy, Suspense, useMemo, Component } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Home } from 'lucide-react'
import { getPublicHubFeatures, HUB_PASSWORD_REQUIRED } from '../lib/api/hubs.js'
import { getModule } from '../modules/index.js'
import AppHeader from '../components/shared/AppHeader.jsx'
import HubGate from '../components/shared/HubGate.jsx'

export default function HubPage() {
  const { hubKey, featureKey } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [hub, setHub] = useState(null)
  const [modules, setModules] = useState([])
  const [error, setError] = useState(null)
  // 이 허브에 비밀번호가 걸려 있고 아직 못 푼 상태. { key, name }
  const [locked, setLocked] = useState(null)

  const load = useCallback(async () => {
    try {
      // 허브 스코프 조회 — 허브에 비밀번호가 걸려 있으면 그 허브의 비밀번호를 요구한다.
      // (플랫폼 비밀번호는 마스터키라 있으면 그대로 통과한다.)
      const { hub: loadedHub, features } = await getPublicHubFeatures(hubKey)
      // enabled 모듈 중 클라 레지스트리에 존재하는 것만, sort_order 순
      const loadedModules = features
        .filter(f => f.enabled)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        .map(f => getModule(f.feature_key))
        .filter(Boolean)
      setHub(loadedHub)
      setModules(loadedModules)
      setLocked(null)
      setError(null)
    } catch (e) {
      setHub(null)
      setModules([])
      if (e.message === HUB_PASSWORD_REQUIRED) {
        // 잠금은 오류가 아니다 — 비밀번호를 물어보는 화면으로 간다.
        setLocked(e.hub ?? { key: hubKey, name: null })
        setError(null)
      } else {
        setLocked(null)
        setError(e.message)
      }
    } finally {
      setLoading(false)
    }
  }, [hubKey])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="app"><div className="job-skeleton" /></div>
  if (locked) return <HubGate hubKey={hubKey} hubName={locked.name} onUnlock={load} />
  if (error || !hub) return (
    <div className="app">
      <AppHeader toolName="허브를 찾을 수 없음"><Link className="app-new-btn" to="/"><Home size={14} /> 허브 목록</Link></AppHeader>
      <p className="job-empty">허브 "{hubKey}"를 찾을 수 없습니다.</p>
    </div>
  )

  // 모듈 페이지: 모듈이 자기 완결적 풀페이지(AppHeader + 자체 탭 포함 설정)를 그린다.
  if (featureKey) {
    const active = modules.find(m => m.key === featureKey)
    if (!active) return (
      <div className="app">
        <AppHeader toolName={hub.name}><Link className="app-new-btn" to="/"><Home size={14} /> 허브 목록</Link></AppHeader>
        <p className="job-empty">이 허브에 켜진 모듈이 아닙니다.</p>
      </div>
    )
    return <ModulePanel module={active} hubKey={hubKey} />
  }

  // 랜딩: 이 허브가 켠 모듈들을 툴 카드로 보여준다.
  return (
    <div className="hub-wrapper">
      <header className="hub-header">
        <span className="hub-title">{hub.name}</span>
      </header>

      <main className="hub-main">
        <p className="hub-subtitle">어떤 툴을 사용할까요?</p>
        <div className="hub-grid">
          {modules.map(m => (
            <button
              key={m.key}
              className="hub-card"
              onClick={() => navigate(`/hub/${hubKey}/${m.key}`)}
            >
              <span className="hub-card-icon">{m.icon && <m.icon size={28} />}</span>
              <span className="hub-card-name">{m.label}</span>
              <span className="hub-card-desc">{m.description}</span>
            </button>
          ))}
          <div className="hub-card hub-card-empty">
            <span className="hub-card-icon">＋</span>
            <span className="hub-card-empty-name">추가 예정</span>
          </div>
        </div>
      </main>
    </div>
  )
}

// 모듈 패널 렌더. loadPanel이 있으면 지연 로드해 무거운 의존(xlsx·pdfjs)을
// 메인 청크에서 떼어낸다. 없으면 기존 HubPanel 계약을 그대로 쓴다(후방호환).
const lazyPanelCache = new Map()

// 지연 로드된 패널 청크가 404/네트워크 오류로 실패하면 lazy가 reject하고, 경계가 없으면
// 그 rejection이 루트까지 올라가 React가 트리 전체를 언마운트한다 — 패널 하나가 아니라
// SmartHub 전체가 빈 화면이 된다. 가장 흔한 원인은 새 버전 배포(Vite의 콘텐츠 해시
// 파일명이 바뀌어 열려 있던 탭이 참조하는 청크가 사라짐)이므로 새로고침을 권한다.
class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('[HubPage] 모듈 패널 로드/렌더 실패:', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="app">
        <div className="job-empty">
          <p style={{ margin: 0 }}>모듈을 불러오지 못했습니다.</p>
          <span className="hub-card-desc">
            새 버전이 배포되어 이 화면이 참조하던 파일이 더 이상 없을 가능성이 큽니다.
            새로고침하면 최신 버전으로 다시 시도합니다.
          </span>
          <button type="button" className="app-new-btn" onClick={() => window.location.reload()}>
            새로고침
          </button>
        </div>
      </div>
    )
  }
}

function ModulePanel({ module: mod, hubKey }) {
  const Panel = useMemo(() => {
    if (!mod.loadPanel) return mod.HubPanel
    // 같은 모듈을 오갈 때마다 새 lazy를 만들면 매번 Suspense가 뜬다 — 키로 캐시한다.
    if (!lazyPanelCache.has(mod.key)) lazyPanelCache.set(mod.key, lazy(mod.loadPanel))
    return lazyPanelCache.get(mod.key)
  }, [mod])

  const panel = (
    <Suspense fallback={<div className="app"><div className="job-skeleton" /></div>}>
      {/* eslint-disable-next-line react-hooks/static-components -- Panel is looked up from
          lazyPanelCache (module-level Map keyed by mod.key), so its identity is stable across
          renders of the same module; the rule can't see through the cache lookup. */}
      <Panel hubKey={hubKey} />
    </Suspense>
  )

  // 모든 모듈은 자기 완결적 풀페이지를 그린다(자체 .app 셸 + AppHeader) — HubPage는 래퍼를 씌우지 않는다.
  // key로 모듈 전환 시 경계 상태를 초기화한다(다른 모듈은 정상 로드될 수 있으므로).
  return <PanelErrorBoundary key={mod.key}>{panel}</PanelErrorBoundary>
}
