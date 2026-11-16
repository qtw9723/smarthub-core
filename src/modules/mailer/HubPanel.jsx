// mailer 모듈 — 완결된 풀 페이지 (AppHeader + 탭: 스케줄/발신 계정). hubKey로 스코프.
import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { getJobs, createJob, updateJob, deleteJob, reorderJobs, getSenders } from '../../lib/api/mailer.js'
import { getCookie, clearCookie } from '../../lib/auth.js'
import AppHeader from '../../components/shared/AppHeader.jsx'
import ConfirmDialog from '../../components/shared/ConfirmDialog.jsx'
import JobRow from '../../components/mailer/JobRow.jsx'
import JobModal from '../../components/mailer/JobModal.jsx'
import SettingsPanel from './SettingsPanel.jsx'

export default function HubPanel({ hubKey }) {
  const navigate = useNavigate()
  const password = getCookie()
  const [tab, setTab] = useState('jobs')
  const [jobs, setJobs] = useState([])
  const [senders, setSenders] = useState([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editJob, setEditJob] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [confirm, setConfirm] = useState(null)
  const [togglingIds, setTogglingIds] = useState(new Set())
  const pollRef = useRef(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const refreshJobs = useCallback(async () => {
    try {
      const data = await getJobs(password, hubKey)
      setJobs(data.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)))
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') {
        clearCookie()
        navigate('/login')
      }
    } finally {
      setInitialLoading(false)
    }
  }, [password, hubKey, navigate])

  const loadSenders = useCallback(async () => {
    try { setSenders(await getSenders(password, hubKey)) } catch { /* 발신 계정 로드는 best-effort */ }
  }, [password, hubKey])

  useEffect(() => {
    refreshJobs()
    loadSenders()
    pollRef.current = setInterval(refreshJobs, 60_000)
    return () => clearInterval(pollRef.current)
  }, [refreshJobs, loadSenders])

  const handleCreate = async (formData) => {
    setLoading(true)
    try {
      const job = await createJob(formData, password, hubKey)
      setJobs(prev => [job, ...prev])
      setShowModal(false)
      toast.success(`"${job.name}" 작업을 만들었습니다`)
    } catch {
      toast.error('작업 생성에 실패했습니다')
    } finally { setLoading(false) }
  }

  const handleUpdate = async (id, patch) => {
    try {
      const job = await updateJob(id, patch, password, hubKey)
      setJobs(prev => prev.map(j => j.id === id ? { ...j, ...job } : j))
      setEditJob(null)
      setShowModal(false)
      toast.success('작업을 수정했습니다')
    } catch {
      toast.error('작업 수정에 실패했습니다')
    }
  }

  // 낙관적 토글 + 실패 롤백
  const handleToggle = async (job) => {
    const nextActive = !job.is_active
    setTogglingIds(prev => new Set(prev).add(job.id))
    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, is_active: nextActive } : j))
    try {
      await updateJob(job.id, { is_active: nextActive }, password, hubKey)
      toast.success(nextActive ? `"${job.name}" 시작됨` : `"${job.name}" 중지됨`)
    } catch {
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, is_active: !nextActive } : j))
      toast.error('상태 변경에 실패했습니다')
    } finally {
      setTogglingIds(prev => { const s = new Set(prev); s.delete(job.id); return s })
    }
  }

  const requestDelete = (job) => setConfirm({
    title: '작업 삭제',
    message: `"${job.name}" 작업을 삭제할까요? 되돌릴 수 없습니다.`,
    confirmLabel: '삭제',
    danger: true,
    action: async () => {
      try {
        await deleteJob(job.id, password, hubKey)
        setJobs(prev => prev.filter(j => j.id !== job.id))
        toast.success('작업을 삭제했습니다')
      } catch {
        toast.error('삭제에 실패했습니다')
      }
    },
  })

  const requestDeleteSelected = () => setConfirm({
    title: '작업 일괄 삭제',
    message: `선택한 ${selectedIds.size}개 작업을 삭제할까요? 되돌릴 수 없습니다.`,
    confirmLabel: `${selectedIds.size}개 삭제`,
    danger: true,
    action: async () => {
      try {
        await Promise.all([...selectedIds].map(id => deleteJob(id, password, hubKey)))
        setJobs(prev => prev.filter(j => !selectedIds.has(j.id)))
        setSelectedIds(new Set())
        toast.success('선택한 작업을 삭제했습니다')
      } catch {
        toast.error('일부 작업 삭제에 실패했습니다')
        refreshJobs()
      }
    },
  })

  const requestResetCount = (job) => setConfirm({
    title: '순번 초기화',
    message: `"${job.name}"의 발송 순번을 0으로 초기화할까요?`,
    confirmLabel: '초기화',
    action: async () => {
      try {
        const updated = await updateJob(job.id, { send_count: 0 }, password, hubKey)
        setJobs(prev => prev.map(j => j.id === job.id ? { ...j, ...updated } : j))
        toast.success('순번을 초기화했습니다')
      } catch {
        toast.error('초기화에 실패했습니다')
      }
    },
  })

  const handleDuplicate = async (job) => {
    try {
      const { name, sender, sender_account_id, subject, body, recipients, interval_minutes, use_index, attachments } = job
      const match = name.match(/^\[(\d+)\] (.+)$/)
      const newName = match ? `[${Number(match[1]) + 1}] ${match[2]}` : `[0] ${name}`
      const newJob = await createJob({ name: newName, sender, sender_account_id, subject, body, recipients, interval_minutes, use_index, attachments }, password, hubKey)
      setJobs(prev => [newJob, ...prev])
      toast.success(`"${newJob.name}"으로 복제했습니다`)
    } catch {
      toast.error('복제에 실패했습니다')
    }
  }

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return
    const oldIndex = jobs.findIndex(j => j.id === active.id)
    const newIndex = jobs.findIndex(j => j.id === over.id)
    const reordered = arrayMove(jobs, oldIndex, newIndex)
    setJobs(reordered)
    reorderJobs(reordered.map(j => j.id), password, hubKey).catch(() => toast.error('순서 저장에 실패했습니다'))
  }

  const activeJobs = jobs.filter(j => j.is_active)
  const inactiveJobs = jobs.filter(j => !j.is_active)

  const renderRow = (job) => (
    <JobRow
      key={job.id}
      job={job}
      senders={senders}
      selected={selectedIds.has(job.id)}
      toggling={togglingIds.has(job.id)}
      onSelect={checked => setSelectedIds(prev => {
        const s = new Set(prev)
        if (checked) s.add(job.id); else s.delete(job.id)
        return s
      })}
      onToggle={() => handleToggle(job)}
      onEdit={() => { setEditJob(job); setShowModal(true) }}
      onDuplicate={() => handleDuplicate(job)}
      onDelete={() => requestDelete(job)}
      onResetCount={() => requestResetCount(job)}
    />
  )

  return (
    <div className="app">
      <AppHeader toolName="Mailer">
        {tab === 'jobs' && (
          <button className="app-new-btn" onClick={() => { setEditJob(null); setShowModal(true) }}>
            <Plus size={14} /> 새 작업
          </button>
        )}
      </AppHeader>

      <nav className="nav-tabs">
        <button className={`nav-tab${tab === 'jobs' ? ' active' : ''}`} onClick={() => setTab('jobs')}>스케줄</button>
        <button className={`nav-tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>발신 계정</button>
      </nav>

      {tab === 'jobs' ? (
        <>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={jobs.map(j => j.id)} strategy={verticalListSortingStrategy}>
              <div className="job-list">
                {jobs.length > 0 && (
                  <div className="bulk-bar">
                    <label className="bulk-select-all">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === jobs.length}
                        onChange={e => setSelectedIds(e.target.checked ? new Set(jobs.map(j => j.id)) : new Set())}
                      />
                      전체 선택
                    </label>
                    {selectedIds.size > 0 && (
                      <button className="bulk-delete-btn" onClick={requestDeleteSelected}>
                        <Trash2 size={12} /> {selectedIds.size}개 삭제
                      </button>
                    )}
                  </div>
                )}
                {initialLoading ? (
                  <>
                    <div className="job-skeleton" />
                    <div className="job-skeleton" />
                    <div className="job-skeleton" />
                  </>
                ) : jobs.length === 0 ? (
                  <div className="job-empty">
                    <p>발송 작업이 없습니다.</p>
                    <button className="app-new-btn" onClick={() => { setEditJob(null); setShowModal(true) }}>
                      <Plus size={14} /> 새 작업
                    </button>
                  </div>
                ) : (
                  <>
                    {activeJobs.length > 0 && <div className="job-group-head">활성 ({activeJobs.length})</div>}
                    {activeJobs.map(renderRow)}
                    {inactiveJobs.length > 0 && <div className="job-group-head">중지됨 ({inactiveJobs.length})</div>}
                    {inactiveJobs.map(renderRow)}
                  </>
                )}
              </div>
            </SortableContext>
          </DndContext>

          {showModal && (
            <JobModal
              job={editJob}
              senders={senders}
              hubKey={hubKey}
              password={password}
              onSubmit={editJob ? (data) => handleUpdate(editJob.id, data) : handleCreate}
              onClose={() => { setShowModal(false); setEditJob(null) }}
              loading={loading}
            />
          )}
        </>
      ) : (
        <SettingsPanel hubKey={hubKey} />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          onConfirm={async () => { await confirm.action(); setConfirm(null) }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
