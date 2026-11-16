// mailer 모듈 — 설정 패널 (발신 계정 관리, Gmail 앱 비밀번호). hubKey로 스코프.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { getSenders, createSender, deleteSender } from '../../lib/api/mailer.js'
import { getCookie, clearCookie } from '../../lib/auth.js'
import ConfirmDialog from '../../components/shared/ConfirmDialog.jsx'
import SenderPage from '../../components/mailer/SenderPage.jsx'
import SenderModal from '../../components/mailer/SenderModal.jsx'

export default function SettingsPanel({ hubKey }) {
  const navigate = useNavigate()
  const password = getCookie()
  const [senders, setSenders] = useState([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState(null)

  const load = useCallback(async () => {
    try {
      setSenders(await getSenders(password, hubKey))
    } catch (e) {
      if (e.message === 'UNAUTHORIZED') {
        clearCookie()
        navigate('/login')
      } else {
        toast.error('발신 계정을 불러오지 못했습니다')
      }
    } finally {
      setInitialLoading(false)
    }
  }, [password, hubKey, navigate])

  useEffect(() => { load() }, [load])

  const handleCreate = async (data) => {
    setSaving(true)
    try {
      const sender = await createSender(data, password, hubKey)
      setSenders(prev => [...prev, sender])
      setShowModal(false)
      toast.success(`${sender.email} 계정을 추가했습니다`)
    } catch {
      toast.error('계정 추가에 실패했습니다')
    } finally {
      setSaving(false)
    }
  }

  const requestDelete = (id) => setConfirm({
    title: '발신 계정 삭제',
    message: '이 발신 계정을 삭제할까요? 이 계정을 쓰는 작업은 발송에 실패하게 됩니다.',
    confirmLabel: '삭제',
    danger: true,
    action: async () => {
      try {
        await deleteSender(id, password, hubKey)
        setSenders(prev => prev.filter(s => s.id !== id))
        toast.success('계정을 삭제했습니다')
      } catch {
        toast.error('계정 삭제에 실패했습니다')
      }
    },
  })

  if (initialLoading) return <p className="job-empty">불러오는 중…</p>

  return (
    <div>
      <div className="header-actions" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
        <button className="app-new-btn" onClick={() => setShowModal(true)}>
          <Plus size={14} /> 계정 추가
        </button>
      </div>

      <SenderPage senders={senders} onDelete={requestDelete} />

      {showModal && (
        <SenderModal
          onSubmit={handleCreate}
          onClose={() => setShowModal(false)}
          loading={saving}
        />
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
