// src/pages/AdminPage.jsx — 백오피스: 전체 허브 관망 + 허브별 모듈 토글 + 자동화/이벤트 현황
// 승인된 목업(backoffice-mockup.html) 룩을 그대로 재현. 스타일은 src/index.css의 .bo 스코프.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Plus, ExternalLink, GripVertical, Search, Trash2, Clock, Lock, Unlock, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  getOverview, getActivity, createHub, updateHub, deleteHub, setHubFeature, setHubPassword,
  getSecurity, setModuleSecurity, setHubSecurityAck, changeMasterKey,
} from '../lib/api/admin.js'
import { getModules } from '../modules/index.js'
import { getCookie, setCookie, clearCookie } from '../lib/auth.js'
import { hubExternalUrl } from '../lib/hubLinks.js'
import { defaultLevelMap, defaultLevelOf, levelMapFrom, riskyKeysOf, violationOf, securityReasonOf, levelLabel, migrationHint } from '../lib/securityPolicy.js'
import { fmtKst } from '../lib/datetime.js'
import Modal from '../components/shared/Modal.jsx'
import ConfirmDialog from '../components/shared/ConfirmDialog.jsx'
import SecurityViolationPopup from '../components/admin/SecurityViolationPopup.jsx'
import SecurityPolicySection from '../components/admin/SecurityPolicySection.jsx'
import MasterKeySection from '../components/admin/MasterKeySection.jsx'
import { securityPopupSeen, markSecurityPopupSeen } from '../lib/securityPopupSession.js'

const ALL_MODULES = getModules() // 클라 레지스트리 (key, label, icon 포함)
const DEFAULT_LEVEL_MAP = defaultLevelMap()
const SHORT_LABEL = {
  'chatbot-monitoring': '챗봇', 'grafana-reports': 'Grafana', mailer: '메일',
  'sheet-to-schema': '스키마 변환', 'doc-to-api': 'API 생성',
}

const isUnauthorized = (e) => e?.message === 'UNAUTHORIZED'

export default function AdminPage() {
  const navigate = useNavigate()
  const password = getCookie()

  const [overview, setOverview] = useState(null) // [{ hub, features }]
  const [activity, setActivity] = useState(null) // { events, automations }
  const [search, setSearch] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newName, setNewName] = useState('')
  // 기본 잠금: 비밀번호를 넣거나, 공개로 만든다고 명시하거나 — 둘 중 하나는 해야 만들어진다.
  const [newPassword, setNewPassword] = useState('')
  const [newPublicAck, setNewPublicAck] = useState(false)
  const [creating, setCreating] = useState(false)

  const [confirmDeleteHub, setConfirmDeleteHub] = useState(null)
  // 공개 허브에 보호가 필요한 모듈(외부 비용·비밀번호 필요)을 켜려는 요청 — 무엇이 열리는지 확인받고 진행한다. { hub, moduleKey }
  const [confirmCostFeature, setConfirmCostFeature] = useState(null)
  // 보호가 필요한 모듈이 켜진 허브의 비밀번호를 해제하려는 요청 — 해제 = 공개다. { hub }
  const [confirmUnlockHub, setConfirmUnlockHub] = useState(null)
  // 비밀번호를 설정/해제할 허브. { id, name, has_password }
  const [pwHub, setPwHub] = useState(null)
  const [hubPwInput, setHubPwInput] = useState('')
  const [savingHubPw, setSavingHubPw] = useState(false)
  const [togglingHubIds, setTogglingHubIds] = useState(new Set())
  const [togglingFeatureKeys, setTogglingFeatureKeys] = useState(new Set())
  const [featureOverrides, setFeatureOverrides] = useState({}) // `${hubId}:${moduleKey}` -> boolean (낙관적 표시용)

  // 모듈 보안 레벨(실효값). 받기 전·실패 시에는 코드 기본값으로 판정한다 — 경고가 사라지지 않게.
  const [securityModules, setSecurityModules] = useState(null) // GET /security의 modules
  const [securityState, setSecurityState] = useState('loading') // 'loading' | 'ok' | 'error'
  const levelMap = useMemo(() => (securityModules ? levelMapFrom(securityModules) : DEFAULT_LEVEL_MAP), [securityModules])
  // 보안 정책 영역의 행: 클라 레지스트리 순서, 응답에 없는 모듈(또는 실패 시 전부)은 기본값 행.
  const securityRows = useMemo(() => ALL_MODULES.map(m =>
    securityModules?.find(r => r.key === m.key)
      ?? { key: m.key, defaultLevel: defaultLevelOf(m.key), level: defaultLevelOf(m.key), reason: null }), [securityModules])
  // 이유 문구 — 관리자가 조정한 레벨이면 조정 사실·사유(QA F2, 사용자 결정 A)
  const reasonOf = useCallback((key) => securityReasonOf(key, securityModules?.find(r => r.key === key)), [securityModules])
  const [showSecurityPopup, setShowSecurityPopup] = useState(false)
  const popupDecided = useRef(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleAuthError = useCallback((e) => {
    if (isUnauthorized(e)) { clearCookie(); navigate('/login'); return true }
    return false
  }, [navigate])

  const refreshOverview = useCallback(async () => {
    try {
      setOverview(await getOverview(password))
    } catch (e) {
      if (!handleAuthError(e)) toast.error('허브 현황을 불러오지 못했습니다')
    }
  }, [password, handleAuthError])

  const refreshActivity = useCallback(async () => {
    try {
      setActivity(await getActivity(password))
    } catch (e) {
      if (!handleAuthError(e)) toast.error('활동 로그를 불러오지 못했습니다')
    }
  }, [password, handleAuthError])

  const refreshSecurity = useCallback(async () => {
    try {
      const res = await getSecurity(password)
      setSecurityModules(res?.modules ?? null)
      setSecurityState('ok')
    } catch (e) {
      if (!handleAuthError(e)) setSecurityState('error')
    }
  }, [password, handleAuthError])

  useEffect(() => { refreshSecurity() }, [refreshSecurity])

  // 못 불러왔으면(마이그레이션 전·일시 오류) 60초마다 다시 읽는다 — 적용 뒤 새로고침 없이 풀리게.
  useEffect(() => {
    if (securityState !== 'error') return
    const t = setInterval(refreshSecurity, 60_000)
    return () => clearInterval(t)
  }, [securityState, refreshSecurity])

  // 레벨 저장 → 실효 맵이 바뀌어 배너·카드·확인 대상이 즉시 따라온다. 실패는 영역에 표시하도록 다시 던진다.
  // 마스터 키 바꾸기 — 성공하면 이 브라우저의 쿠키도 새 키로 바꿔 이어서 쓴다(다시 로그인하지 않게).
  const [, setKeyVersion] = useState(0)
  const saveMasterKey = async (next) => {
    try {
      await changeMasterKey(next, password)
    } catch (e) {
      if (handleAuthError(e)) return
      throw new Error('바꾸지 못했습니다')
    }
    setCookie(next)
    setKeyVersion((v) => v + 1)
    toast.success('마스터 키를 바꿨습니다 — 다른 브라우저·사람은 새 키로 다시 들어와야 합니다')
  }

  const saveModuleSecurity = async (key, body) => {
    try {
      const row = await setModuleSecurity(key, body, password)
      setSecurityModules(prev => [...(prev ?? []).filter(r => r.key !== key), row])
      toast.success(`${ALL_MODULES.find(m => m.key === key)?.label ?? key} 보안 레벨 → ${levelLabel(row.level)}`)
    } catch (e) {
      if (!handleAuthError(e)) toast.error(String(e.message).includes('REASON_REQUIRED') ? '기본보다 낮추려면 사유가 필요합니다' : `보안 레벨 저장에 실패했습니다${migrationHint(e)}`)
      throw e
    }
  }

  useEffect(() => {
    refreshOverview()
    refreshActivity()
    const t = setInterval(() => { refreshOverview(); refreshActivity() }, 60_000)
    return () => clearInterval(t)
  }, [refreshOverview, refreshActivity])

  // ── 파생 데이터: 전역 요약 ──
  const summary = useMemo(() => {
    const hubs = overview ?? []
    const totalHubs = hubs.length
    const activeHubs = hubs.filter(o => o.hub.enabled).length

    const moduleCounts = {}
    for (const o of hubs) for (const f of o.features) moduleCounts[f.key] = (moduleCounts[f.key] ?? 0) + 1
    const activeAutomations = Object.values(moduleCounts).reduce((n, c) => n + c, 0)
    const moduleCountSub = ALL_MODULES
      .filter(m => moduleCounts[m.key] > 0)
      .map(m => `${SHORT_LABEL[m.key] ?? m.label} ${moduleCounts[m.key]}`)
      .join(' · ') || '켜진 모듈 없음'

    let failingTotal = 0
    let firstFailing = null
    for (const o of hubs) {
      const chat = o.features.find(f => f.key === 'chatbot-monitoring')
      const failing = chat?.summary?.failing_count ?? 0
      if (failing > 0) {
        failingTotal += failing
        if (!firstFailing) {
          const bad = (chat.items ?? []).find(i => i.last_check && !i.last_check.ok)
          firstFailing = { hubKey: o.hub.key, botName: bad?.name ?? '봇' }
        }
      }
    }
    const failingSub = failingTotal === 0
      ? '문제 없음'
      : `${firstFailing.botName} 챗봇 실패 (${firstFailing.hubKey})` + (failingTotal > 1 ? ` 외 ${failingTotal - 1}건` : '')

    const events = activity?.events ?? []
    const sendEvents = events.filter(e => (e.type === 'grafana' || e.type === 'mailer') && e.severity === 'good')
    const latestSend = sendEvents[0]
    const sendSub = latestSend
      ? `${latestSend.title} · ${fmtKst(latestSend.at).slice(11)}`
      : '최근 발송 없음'

    // 잠그는 것을 잊는 사고를 막는 경고: 비밀번호 없는 허브에서 비밀번호가 필요한(L2+) 모듈이 켜진 조합.
    // 판정은 src/lib/securityPolicy.js(실효 레벨 맵). 확인된 예외(acked)는 배너·팝업에서 빼고 카드에 회색으로 남긴다.
    const violations = hubs
      .map(o => { const v = violationOf(o.hub, o.features.map(f => f.key), levelMap); return v && { hub: o.hub, ...v } })
      .filter(Boolean)
    const openViolations = violations.filter(v => !v.acked)
    const costRiskHubs = openViolations.map(v => v.hub)

    return {
      totalHubs, activeHubs, inactiveHubs: totalHubs - activeHubs,
      activeAutomations, moduleCountSub,
      failingTotal, failingSub,
      sendCount: sendEvents.length, sendSub,
      costRiskHubs, openViolations,
    }
  }, [overview, activity, levelMap])

  // 진입 팝업: 허브 현황과 레벨(또는 그 실패)이 모두 정해진 뒤 한 번만 판정한다.
  useEffect(() => {
    if (popupDecided.current || overview == null || securityState === 'loading') return
    popupDecided.current = true
    if (summary.openViolations.length > 0 && !securityPopupSeen()) setShowSecurityPopup(true)
  }, [overview, securityState, summary.openViolations.length])

  const closeSecurityPopup = () => { markSecurityPopupSeen(); setShowSecurityPopup(false) }

  // 팝업 안에서 위반을 모두 처리(확인함·비밀번호)하면 닫고 본 것으로 남긴다 — 열린 상태로 남아 있으면
  // 같은 세션에서 새 위반이 생길 때 진입 팝업이 다시 뜬다(세션당 1회 위반).
  useEffect(() => {
    if (showSecurityPopup && summary.openViolations.length === 0) {
      markSecurityPopupSeen()
      setShowSecurityPopup(false)
    }
  }, [showSecurityPopup, summary.openViolations.length])

  // ── 확인된 예외: 위반을 알고도 공개로 둔다. level = 확인 시점의 요구 레벨, null = 해제 ──
  const setHubAck = async (hub, level) => {
    try {
      await setHubSecurityAck(hub.id, level, password)
      setOverview(prev => (prev ?? []).map(o =>
        o.hub.id === hub.id ? { ...o, hub: { ...o.hub, security_ack_level: level } } : o))
      toast.success(level ? `"${hub.name}" 공개 유지를 확인했습니다(${levelLabel(level)}까지)` : `"${hub.name}" 예외를 해제했습니다`)
      // 진행 중이던 60초 갱신 응답이 위 로컬 반영을 덮어쓰지 않게 다시 읽는다(toggleFeature와 같은 방식).
      await refreshOverview()
    } catch (e) {
      if (!handleAuthError(e)) toast.error(`예외 저장에 실패했습니다${migrationHint(e)}`)
    }
  }

  // ── 파생 데이터: 검색 필터(허브 그리드 표시용, 원본 순서는 유지) ──
  const filteredOverview = useMemo(() => {
    const list = overview ?? []
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(o => o.hub.name.toLowerCase().includes(q) || o.hub.key.toLowerCase().includes(q))
  }, [overview, search])

  // ── 파생 데이터: 모듈 관점 ──
  const modulePerspective = useMemo(() => ALL_MODULES.map(m => ({
    module: m,
    hubKeys: (overview ?? []).filter(o => o.features.some(f => f.key === m.key)).map(o => o.hub.key),
  })), [overview])

  // ── 허브 추가 ──
  const handleCreate = async (e) => {
    e.preventDefault()
    // 서버도 같은 규칙으로 거절하지만(PUBLIC_ACK_REQUIRED), 여기서 먼저 막아
    // "왜 안 만들어지지"가 아니라 무엇을 해야 하는지가 보이게 한다.
    if (!newPassword.trim() && !newPublicAck) {
      toast.error('비밀번호를 설정하거나, 공개로 만든다고 확인해 주세요')
      return
    }
    setCreating(true)
    try {
      const plain = newPassword.trim()
      await createHub({
        key: newKey.trim().toLowerCase(),
        name: newName.trim(),
        ...(plain ? { password: plain } : { public_ack: true }),
      }, password)
      toast.success(plain ? `"${newName}" 허브를 추가했습니다` : `"${newName}" 허브를 공개로 추가했습니다`)
      setShowAdd(false); setNewKey(''); setNewName(''); setNewPassword(''); setNewPublicAck(false)
      refreshOverview()
    } catch (e) {
      if (!handleAuthError(e)) toast.error(e.message.includes('exists') ? '이미 있는 허브 key입니다' : '허브 추가에 실패했습니다')
    } finally {
      setCreating(false)
    }
  }

  // ── 허브 삭제 ──
  const handleDeleteHub = async () => {
    const hub = confirmDeleteHub
    if (!hub) return
    try {
      await deleteHub(hub.id, password)
      setOverview(prev => (prev ?? []).filter(o => o.hub.id !== hub.id))
      toast.success(`"${hub.name}" 허브를 삭제했습니다`)
    } catch (e) {
      if (!handleAuthError(e)) toast.error('허브 삭제에 실패했습니다')
    } finally {
      setConfirmDeleteHub(null)
    }
  }

  // ── 허브 비밀번호 설정/해제 ──
  // 빈 입력으로 저장하면 해제 = 그 허브는 로그인 없이 열린다.
  const saveHubPassword = async (e) => {
    e.preventDefault()
    const hub = pwHub
    if (!hub) return
    const next = hubPwInput.trim()

    // 해제는 그 허브를 공개로 만드는 일이다. 비용 모듈이 켜져 있으면 그 순간
    // 무인증 청구 경로가 열리므로, 켜는 쪽과 같은 확인을 받는다(대칭).
    if (next === '' && hub.has_password) {
      const onKeys = (overview ?? []).find(o => o.hub.id === hub.id)?.features.map(f => f.key) ?? []
      const risky = riskyKeysOf({ has_password: false }, onKeys, levelMap)
      if (risky.length > 0) { setConfirmUnlockHub({ hub, risky }); return }
    }

    return applyHubPassword(hub, next)
  }

  const applyHubPassword = async (hub, next) => {
    setSavingHubPw(true)
    try {
      await setHubPassword(hub.id, next, password)
      setOverview(prev => (prev ?? []).map(o =>
        // 비밀번호를 설정하면 서버가 확인된 예외를 지운다 — 화면도 맞춘다.
        o.hub.id === hub.id
          ? { ...o, hub: { ...o.hub, has_password: next !== '', ...(next !== '' && { security_ack_level: null }) } }
          : o))
      toast.success(next === ''
        ? `"${hub.name}" 허브 비밀번호를 해제했습니다 (이제 공개)`
        : `"${hub.name}" 허브 비밀번호를 설정했습니다`)
      setPwHub(null); setHubPwInput('')
    } catch (e) {
      if (!handleAuthError(e)) toast.error('허브 비밀번호 변경에 실패했습니다')
    } finally {
      setSavingHubPw(false)
    }
  }

  // ── 허브 활성/비활성 토글 (낙관적 + 롤백) ──
  const toggleHub = async (hub) => {
    const next = !hub.enabled
    setTogglingHubIds(prev => new Set(prev).add(hub.id))
    setOverview(prev => prev.map(o => o.hub.id === hub.id ? { ...o, hub: { ...o.hub, enabled: next } } : o))
    try {
      await updateHub(hub.id, { enabled: next }, password)
    } catch (e) {
      setOverview(prev => prev.map(o => o.hub.id === hub.id ? { ...o, hub: { ...o.hub, enabled: hub.enabled } } : o))
      if (!handleAuthError(e)) toast.error('허브 상태 변경에 실패했습니다')
    } finally {
      setTogglingHubIds(prev => { const s = new Set(prev); s.delete(hub.id); return s })
    }
  }

  // ── 허브별 모듈 토글 (낙관적 오버레이 + 성공 시 재조회, 실패 시 오버레이만 걷어내 원복) ──
  const toggleFeature = async (hub, moduleKey, currentlyOn) => {
    // 공개 허브 + 외부 비용 모듈은 "URL을 아는 누구나 청구를 만들 수 있는" 조합이다.
    // 켜진 뒤 빨간 경고로 알리는 것(riskyKeysOf)만으로는 늦다 — 켜기 전에 묻는다.
    // 끄는 방향과 잠긴 허브는 묻지 않는다: 되돌리는 일과 안전한 일에 마찰을 두지 않는다.
    if (!currentlyOn && riskyKeysOf(hub, [moduleKey], levelMap).length > 0) {
      setConfirmCostFeature({ hub, moduleKey })
      return
    }
    return applyFeatureToggle(hub, moduleKey, currentlyOn)
  }

  const applyFeatureToggle = async (hub, moduleKey, currentlyOn) => {
    const ok = `${hub.id}:${moduleKey}`
    const label = ALL_MODULES.find(m => m.key === moduleKey)?.label ?? moduleKey
    setFeatureOverrides(prev => ({ ...prev, [ok]: !currentlyOn }))
    setTogglingFeatureKeys(prev => new Set(prev).add(ok))
    try {
      await setHubFeature(hub.key, moduleKey, { enabled: !currentlyOn }, password)
      toast.success(`${hub.name} · ${label} ${currentlyOn ? '끔' : '켬'}`)
      await refreshOverview()
    } catch (e) {
      if (!handleAuthError(e)) toast.error('모듈 토글에 실패했습니다')
    } finally {
      setFeatureOverrides(prev => { const n = { ...prev }; delete n[ok]; return n })
      setTogglingFeatureKeys(prev => { const s = new Set(prev); s.delete(ok); return s })
    }
  }

  // ── 허브 카드 드래그 순서변경: 화면(필터된) 순서를 전체 배열에 되접어 넣고 sort_order 저장 ──
  const handleDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id || !overview) return
    const oldIndex = filteredOverview.findIndex(o => o.hub.id === active.id)
    const newIndex = filteredOverview.findIndex(o => o.hub.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reorderedFiltered = arrayMove(filteredOverview, oldIndex, newIndex)
    const filteredIds = new Set(filteredOverview.map(o => o.hub.id))
    let qi = 0
    const nextOverview = overview.map(o => filteredIds.has(o.hub.id) ? reorderedFiltered[qi++] : o)
    setOverview(nextOverview)
    try {
      await Promise.all(nextOverview.map((o, i) => updateHub(o.hub.id, { sort_order: i }, password)))
    } catch (e) {
      if (!handleAuthError(e)) { toast.error('순서 저장에 실패했습니다'); refreshOverview() }
    }
  }

  return (
    <div className="bo">
      <div className="wrap">
        <header className="topbar">
          <div className="brand">
            <span className="eyebrow">SmartHub · Back office</span>
            <h1>전체 허브 관망</h1>
            <p>팀(허브) × 자동화 모듈을 한 곳에서. 문제는 위에서, 관리는 아래에서.</p>
          </div>
          <div className="topbar-actions">
            <Link className="btn" to="/">허브 목록</Link>
            <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> 허브 추가
            </button>
          </div>
        </header>

        <section className="summary">
          <div className={`tile${summary.inactiveHubs === 0 && summary.totalHubs > 0 ? ' ok' : ''}`}>
            {summary.inactiveHubs === 0 && summary.totalHubs > 0 && <span className="stripe" />}
            <span className="k">허브</span>
            <span className="v tnum">{summary.totalHubs}</span>
            <span className="sub">활성 {summary.activeHubs} · 비활성 {summary.inactiveHubs}</span>
          </div>
          <div className="tile">
            <span className="k">활성 자동화</span>
            <span className="v tnum">{summary.activeAutomations}</span>
            <span className="sub">{summary.moduleCountSub}</span>
          </div>
          <div className={`tile${summary.failingTotal > 0 ? ' crit' : ' ok'}`}>
            <span className="stripe" />
            <span className="k">점검 필요</span>
            <span className="v tnum">{summary.failingTotal}</span>
            <span className="sub">{summary.failingSub}</span>
          </div>
          <div className="tile ok">
            <span className="stripe" />
            <span className="k">최근 발송</span>
            <span className="v tnum">{summary.sendCount}</span>
            <span className="sub">{summary.sendSub}</span>
          </div>
        </section>

        {securityState === 'error' && (
          <p className="security-load-error" data-testid="security-load-error">
            보안 레벨을 불러오지 못해 기본값으로 판정하고 있습니다(마이그레이션 미적용 또는 서버 오류).
            {' '}<button type="button" className="hub-risk-ack" onClick={refreshSecurity}>다시 시도</button>
          </p>
        )}

        {summary.costRiskHubs.length > 0 && (
          <div className="cost-risk-banner" data-testid="cost-risk-banner" role="alert">
            <ShieldAlert size={15} />
            <span>
              <b>공개 허브에서 보호가 필요한 모듈(L2 이상)이 켜져 있습니다</b> — {summary.costRiskHubs.map(h => h.name).join(' · ')}.
              비밀번호가 없는 허브의 이 모듈은 <b>URL을 아는 누구나</b> 쓸 수 있습니다(고객 정보 노출·외부 비용·저장된 키 사용 등).
              해당 허브의 자물쇠를 눌러 비밀번호를 설정하거나, 알고도 공개로 둘 거라면 카드에서 "확인함"을 누르세요.
            </span>
          </div>
        )}

        <section className="sec">
          <div className="sec-head">
            <h2>자동화 상태</h2>
            <span className="hint">정시 작업 · 최근 실행 현황</span>
          </div>
          <div className="autos">
            {activity == null ? (
              <div className="job-skeleton" />
            ) : activity.automations.length === 0 ? (
              <div className="empty-hint">등록된 자동화가 없습니다</div>
            ) : (
              activity.automations.map((a, i) => (
                <div className="auto" key={`${a.hubKey}-${a.module}-${i}`}>
                  <div className="ico"><Clock size={16} /></div>
                  <div className="body">
                    <div className="name">{a.hubName} · {a.label}</div>
                    <div className="meta">{a.lastRun ? <>마지막 <b>{fmtKst(a.lastRun)}</b></> : '최근 실행 이력 없음'}</div>
                  </div>
                  {a.lastRun == null ? (
                    <span className="pill idle"><span className="dot" />대기</span>
                  ) : a.ok ? (
                    <span className="pill good"><span className="dot" />정상</span>
                  ) : (
                    <span className="pill warn"><span className="dot" />실패</span>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="sec">
          <div className="sec-head">
            <h2>허브</h2>
            <span className="hint" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              모듈 배지를 눌러 허브별 on/off · 드래그로 순서변경
              <label className="search-field">
                <Search size={13} />
                <input
                  className="search-input" placeholder="이름/키 검색"
                  value={search} onChange={e => setSearch(e.target.value)}
                />
              </label>
            </span>
          </div>

          {overview == null ? (
            <div className="hubs"><div className="job-skeleton" /><div className="job-skeleton" /></div>
          ) : overview.length === 0 ? (
            <div className="job-empty"><p>등록된 허브가 없습니다.</p></div>
          ) : filteredOverview.length === 0 ? (
            <div className="job-empty"><p>"{search}"와 일치하는 허브가 없습니다.</p></div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={filteredOverview.map(o => o.hub.id)} strategy={rectSortingStrategy}>
                <div className="hubs">
                  {filteredOverview.map(entry => (
                    <HubCard
                      key={entry.hub.id}
                      entry={entry}
                      levelMap={levelMap}
                      reasonOf={reasonOf}
                      onAck={(level) => setHubAck(entry.hub, level)}
                      featureOverrides={featureOverrides}
                      togglingHub={togglingHubIds.has(entry.hub.id)}
                      togglingFeatureKeys={togglingFeatureKeys}
                      onToggleHub={() => toggleHub(entry.hub)}
                      onToggleFeature={(moduleKey, on) => toggleFeature(entry.hub, moduleKey, on)}
                      onRequestDelete={() => setConfirmDeleteHub(entry.hub)}
                      onRequestPassword={() => { setPwHub(entry.hub); setHubPwInput('') }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </section>

        <section className="sec cols">
          <div>
            <div className="sec-head"><h2>최근 이벤트</h2><span className="hint">전 허브 통합</span></div>
            <div className="panel feed">
              {activity == null ? (
                <div className="job-skeleton" />
              ) : activity.events.length === 0 ? (
                <div className="empty-hint">최근 이벤트가 없습니다</div>
              ) : (
                activity.events.map((e, i) => {
                  const [first, ...rest] = String(e.title ?? '').split(' ')
                  return (
                    <div className="ev" key={i}>
                      <span className="evdot" style={{ background: `var(--${e.severity})` }} />
                      <div className="et">
                        <div className="l1"><b>{first}</b> {rest.join(' ')}</div>
                        <div className="l2">{[e.hubKey, e.detail].filter(Boolean).join(' · ')}</div>
                      </div>
                      <span className="ts">{fmtKst(e.at).slice(11) || '—'}</span>
                    </div>
                  )
                })
              )}
            </div>
          </div>
          <div>
            <div className="sec-head"><h2>모듈 관점</h2><span className="hint">모듈별 사용 허브</span></div>
            <div className="panel modperspec">
              {modulePerspective.map(({ module, hubKeys }) => (
                <div className="mp" key={module.key}>
                  <div className="mpn">{module.label} <span className="cnt">· {hubKeys.length} 허브</span></div>
                  <div className="hubtags">
                    {hubKeys.length === 0
                      ? <span className="hubtag">없음</span>
                      : hubKeys.map(k => <span className="hubtag" key={k}>{k}</span>)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <SecurityPolicySection
          modules={securityRows} entries={overview ?? []} levelMap={levelMap}
          state={securityState} onSave={saveModuleSecurity}
        />

        <MasterKeySection onSave={saveMasterKey} />
      </div>

      {showAdd && (
        <Modal title="허브 추가" onClose={() => setShowAdd(false)}>
          <form onSubmit={handleCreate}>
            <div className="form-field">
              <label className="form-label">허브 key (영소문자/숫자/하이픈)</label>
              <input className="modal-input" value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="ops" required autoFocus />
            </div>
            <div className="form-field">
              <label className="form-label">허브 이름</label>
              <input className="modal-input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ops" required />
            </div>
            <div className="form-field">
              <label className="form-label" htmlFor="new-hub-password">허브 비밀번호 (선택)</label>
              <input
                id="new-hub-password" className="modal-input" type="password" autoComplete="new-password"
                value={newPassword}
                onChange={e => { setNewPassword(e.target.value); if (e.target.value.trim()) setNewPublicAck(false) }}
                placeholder="비우면 공개 허브가 됩니다"
              />
            </div>
            {!newPassword.trim() && (
              <label className="form-check" htmlFor="new-hub-public-ack">
                <input
                  id="new-hub-public-ack" type="checkbox"
                  checked={newPublicAck} onChange={e => setNewPublicAck(e.target.checked)}
                />
                <span>
                  비밀번호 없이 <strong>공개로 만듭니다</strong> — URL을 아는 누구나 이 허브와 켜진 모듈을 사용할 수 있습니다.
                </span>
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="modal-cancel" onClick={() => setShowAdd(false)}>취소</button>
              <button type="submit" className="modal-submit" disabled={creating}>{creating ? '추가 중…' : '추가'}</button>
            </div>
          </form>
        </Modal>
      )}

      {pwHub && (
        <Modal title={`${pwHub.name} 허브 비밀번호`} onClose={() => setPwHub(null)}>
          <form onSubmit={saveHubPassword}>
            <div className="form-field">
              <label className="form-label">
                새 비밀번호{pwHub.has_password ? ' (현재: 설정됨)' : ' (현재: 공개)'}
              </label>
              <input
                className="modal-input" type="password" value={hubPwInput}
                onChange={e => setHubPwInput(e.target.value)}
                placeholder="비우면 해제 (공개)" autoFocus
              />
              <p className="form-hint">
                /hub/{pwHub.key} 에만 걸리는 비밀번호입니다 — 다른 허브는 영향받지 않습니다.
                비워서 저장하면 해제되어 누구나 들어올 수 있습니다.
                백오피스 비밀번호는 모든 허브를 엽니다.
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="modal-cancel" onClick={() => setPwHub(null)}>취소</button>
              <button type="submit" className="modal-submit" disabled={savingHubPw}>
                {savingHubPw ? '저장 중…' : hubPwInput.trim() === '' ? '해제' : '저장'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDeleteHub && (
        <ConfirmDialog
          title="허브 삭제"
          message={`"${confirmDeleteHub.name}" 허브를 삭제할까요? 연결된 모듈 데이터도 함께 삭제되며 되돌릴 수 없습니다.`}
          confirmLabel="삭제" danger
          onConfirm={handleDeleteHub}
          onCancel={() => setConfirmDeleteHub(null)}
        />
      )}

      {confirmUnlockHub && (
        <ConfirmDialog
          title="비밀번호를 해제하면 공개됩니다"
          message={`"${confirmUnlockHub.hub.name}"에는 보호가 필요한 모듈이 켜져 있습니다 — ${
            confirmUnlockHub.risky.map(k => `${ALL_MODULES.find(m => m.key === k)?.label ?? k}(${levelLabel(levelMap[k])}): ${reasonOf(k)}`).join(' / ')
          }. 비밀번호를 해제하면 URL을 아는 누구나 그 모듈을 쓸 수 있습니다. 계속할까요?`}
          confirmLabel="계속" danger
          onConfirm={() => {
            const { hub } = confirmUnlockHub
            setConfirmUnlockHub(null)
            applyHubPassword(hub, '')
          }}
          onCancel={() => setConfirmUnlockHub(null)}
        />
      )}

      {showSecurityPopup && summary.openViolations.length > 0 && (
        <SecurityViolationPopup
          violations={summary.openViolations}
          levelMap={levelMap}
          securityRows={securityModules ?? undefined}
          onSetPassword={(hub) => { closeSecurityPopup(); setPwHub(hub); setHubPwInput('') }}
          onAck={(hub, level) => setHubAck(hub, level)}
          onClose={closeSecurityPopup}
        />
      )}

      {confirmCostFeature && (
        <ConfirmDialog
          title="공개 허브에 보호가 필요한 모듈을 켭니다"
          message={`"${confirmCostFeature.hub.name}"은(는) 비밀번호가 없는 공개 허브입니다. ${
            ALL_MODULES.find(m => m.key === confirmCostFeature.moduleKey)?.label ?? confirmCostFeature.moduleKey
          }(${levelLabel(levelMap[confirmCostFeature.moduleKey])}) — ${reasonOf(confirmCostFeature.moduleKey)}. 켜면 URL을 아는 누구나 쓸 수 있습니다. 계속할까요? (허브에 비밀번호를 걸면 닫힙니다)`}
          confirmLabel="계속" danger
          onConfirm={() => {
            const { hub, moduleKey } = confirmCostFeature
            setConfirmCostFeature(null)
            applyFeatureToggle(hub, moduleKey, false)
          }}
          onCancel={() => setConfirmCostFeature(null)}
        />
      )}
    </div>
  )
}

// ── 허브 카드 (드래그 가능) ──
function HubCard({ entry, levelMap, reasonOf, onAck, featureOverrides, togglingHub, togglingFeatureKeys, onToggleHub, onToggleFeature, onRequestDelete, onRequestPassword }) {
  const { hub, features } = entry
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: hub.id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const onKeys = new Set(features.map(f => f.key))
  const effectiveOn = (moduleKey) => {
    const ok = `${hub.id}:${moduleKey}`
    return ok in featureOverrides ? featureOverrides[ok] : onKeys.has(moduleKey)
  }

  // 토글 직후에도 즉시 반영되도록 낙관적 상태(effectiveOn) 기준으로 판정한다.
  // 확인된 예외(acked)는 빨강 대신 회색으로 남긴다 — 요구 레벨이 확인 시점보다 오르면 다시 빨강.
  const violation = violationOf(hub, ALL_MODULES.filter(m => effectiveOn(m.key)).map(m => m.key), levelMap)
  const atRisk = !!violation && !violation.acked
  const riskyKeys = atRisk ? violation.riskyKeys : []

  return (
    <article ref={setNodeRef} style={style} className={`hub${hub.enabled ? '' : ' off'}${isDragging ? ' dragging' : ''}${atRisk ? ' at-risk' : ''}`}>
      <div className="hub-head">
        <button type="button" className="grip" {...attributes} {...listeners} aria-label={`${hub.name} 순서 변경`}>
          <GripVertical size={16} />
        </button>
        <div className="hub-title">
          <span className="n">
            <span className="hub-name" title={`${hub.name} (${hub.key})`}>{hub.name}</span>
            {hubExternalUrl(hub.key)
              ? <a className="open" href={hubExternalUrl(hub.key)}>열기 <ExternalLink size={11} /></a>
              : <Link className="open" to={`/hub/${hub.key}`}>열기 <ExternalLink size={11} /></Link>}
          </span>
        </div>
        <span className="key">{hub.key}</span>
        <label className="switch">
          <input type="checkbox" checked={hub.enabled} disabled={togglingHub} onChange={onToggleHub} aria-label={`${hub.name} 활성 토글`} />
          <span className="track"><span className="knob" /></span>
        </label>
        {/* 허브 비밀번호: 잠김이면 자물쇠, 공개면 열린 자물쇠. 이 허브 하나에만 걸리는 비밀번호다. */}
        <button
          type="button"
          className={`hub-lock${hub.has_password ? ' on' : ''}${atRisk ? ' risk' : ''}`}
          onClick={onRequestPassword}
          aria-label={`${hub.name} 비밀번호 ${hub.has_password ? '변경' : '설정'}`}
          title={hub.has_password ? '비밀번호 설정됨 — 클릭해 변경/해제' : '공개 — 클릭해 비밀번호 설정'}
        >
          {hub.has_password ? <Lock size={14} /> : <Unlock size={14} />}
        </button>
        <button type="button" className="hub-delete" onClick={onRequestDelete} aria-label={`${hub.name} 삭제`}>
          <Trash2 size={14} />
        </button>
      </div>

      {atRisk && (
        <div
          className="hub-risk" data-testid={`cost-risk-${hub.key}`}
          title="비밀번호가 없어 이 허브의 보호가 필요한 모듈을 누구나 쓸 수 있습니다 — 자물쇠를 눌러 비밀번호를 설정하세요."
        >
          <ShieldAlert size={12} />
          <span>공개 허브 + {levelLabel(violation.required)} 모듈 — 누구나 사용 가능</span>
          <button type="button" className="hub-risk-ack" onClick={() => onAck(violation.required)}
            title="알고도 공개로 둡니다 — 요구 레벨이 올라가면 다시 경고합니다">확인함</button>
        </div>
      )}

      {violation?.acked && (
        <div className="hub-ack" data-testid={`security-ack-${hub.key}`}
          title="정책 위반을 알고 공개로 둔 허브입니다 — 요구 레벨이 확인 시점보다 올라가면 다시 경고합니다.">
          <ShieldAlert size={12} />
          {/* 현재 요구 레벨을 앞에 둔다 — 레벨을 내린 뒤엔 확인한 레벨이 지금 켜진 것보다 높을 수 있다. */}
          <span>확인된 예외 · 요구 {levelLabel(violation.required)} ({levelLabel(hub.security_ack_level)}까지 확인)</span>
          <button type="button" className="hub-risk-ack" onClick={() => onAck(null)}>예외 해제</button>
        </div>
      )}

      <div className="hub-modules">
        {ALL_MODULES.map(m => {
          const on = effectiveOn(m.key)
          const busy = togglingFeatureKeys.has(`${hub.id}:${m.key}`)
          return (
            <button
              key={m.key} type="button"
              className={`modchip${on ? ' on' : ''}${riskyKeys.includes(m.key) ? ' risk' : ''}`}
              disabled={busy}
              onClick={() => onToggleFeature(m.key, on)}
              title={riskyKeys.includes(m.key)
                ? `${levelLabel(levelMap[m.key])} · ${reasonOf(m.key)} — 이 허브는 공개입니다. 비밀번호를 설정하세요.`
                : (on ? '켜짐 — 클릭해 끄기' : '꺼짐 — 클릭해 켜기')}
            >
              <span className="d" />{m.label}
            </button>
          )
        })}
      </div>

      <div className="statgrid">
        {features.length === 0
          ? <div className="statrow empty">켜진 모듈 없음</div>
          : features.map(f => <StatRow key={f.key} feature={f} />)}
      </div>
    </article>
  )
}

// ── 모듈별 요약 stat 행 ──
function StatRow({ feature }) {
  const s = feature.summary ?? {}
  const ml = SHORT_LABEL[feature.key] ?? feature.key

  if (feature.key === 'chatbot-monitoring') {
    const failing = s.failing_count ?? 0
    const bad = (feature.items ?? []).find(i => i.last_check && !i.last_check.ok)
    return (
      <div className="statrow">
        <span className="ml">{ml}</span>
        <div className="metrics">
          <div className="metric"><span className="mv tnum">{s.bot_count ?? 0}</span><span className="mk">봇</span></div>
          <div className="metric"><span className={`mv tnum${failing > 0 ? ' bad' : ''}`}>{failing}</span><span className="mk">실패</span></div>
          <div className="metric"><span className="mv tnum">{(s.bot_count ?? 0) - failing}</span><span className="mk">정상</span></div>
        </div>
        {failing > 0
          ? <span className="pill crit"><span className="dot" />{bad?.name ?? '점검 필요'}</span>
          : <span className="pill good"><span className="dot" />정상</span>}
      </div>
    )
  }

  if (feature.key === 'grafana-reports') {
    const alertCount = s.last_alert_count ?? 0
    return (
      <div className="statrow">
        <span className="ml">{ml}</span>
        <div className="metrics">
          <div className="metric"><span className="mv">{s.last_analysis_date ?? '없음'}</span><span className="mk">최근 분석</span></div>
          <div className="metric"><span className="mv tnum">{alertCount}</span><span className="mk">점검 포인트</span></div>
        </div>
        {s.enabled === false
          ? <span className="pill idle"><span className="dot" />비활성</span>
          : alertCount > 0
            ? <span className="pill warn"><span className="dot" />{alertCount}건</span>
            : <span className="pill good"><span className="dot" />정상</span>}
      </div>
    )
  }

  if (feature.key === 'mailer') {
    const active = s.active_count ?? 0
    return (
      <div className="statrow">
        <span className="ml">{ml}</span>
        <div className="metrics">
          <div className="metric"><span className="mv tnum">{s.job_count ?? 0}</span><span className="mk">잡</span></div>
          <div className="metric"><span className="mv tnum">{active}</span><span className="mk">활성</span></div>
        </div>
        {active > 0
          ? <span className="pill good"><span className="dot" />발송중</span>
          : <span className="pill idle"><span className="dot" />대기</span>}
      </div>
    )
  }

  return (
    <div className="statrow">
      <span className="ml">{ml}</span>
      <div className="metrics">
        <div className="metric"><span className="mv">{Object.values(s).length ? '연동됨' : '요약 없음'}</span></div>
      </div>
    </div>
  )
}
