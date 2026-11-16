// 백오피스 "마스터 키" — 백오피스·허브 목록을 여는 키를 바꾼다(서버: PUT /api/admin/master-key).
// 바꾸면 서버 설정값(APP_PASSWORD)은 더 이상 통하지 않는다. 잊었을 때 되돌리는 법은 docs/internal-edition.md.
import { useState } from 'react'

const MIN = 8

/** @param {{ onSave: (next: string) => Promise<void> }} props */
export default function MasterKeySection({ onSave }) {
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (next.length < MIN) return setError(`${MIN}자 이상이어야 합니다`)
    if (next !== confirm) return setError('두 칸이 같지 않습니다')
    setError(null)
    setSaving(true)
    try {
      await onSave(next)
      setNext('')
      setConfirm('')
    } catch (e) {
      setError(e?.message || '바꾸지 못했습니다')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="sec" data-testid="master-key">
      <div className="sec-head">
        <h2>마스터 키</h2>
        <span className="hint">백오피스·허브 목록을 여는 키 · 바꾸면 이 브라우저는 새 키로 이어진다</span>
      </div>
      <div className="panel sec-policy">
        <div className="sec-mod-ctl">
          <input className="search-input" type="password" autoComplete="new-password" aria-label="새 마스터 키"
            placeholder={`새 키(${MIN}자 이상)`} value={next} onChange={(e) => { setNext(e.target.value); setError(null) }} />
          <input className="search-input" type="password" autoComplete="new-password" aria-label="새 마스터 키 확인"
            placeholder="한 번 더" value={confirm} onChange={(e) => { setConfirm(e.target.value); setError(null) }} />
          <button type="button" className="btn" aria-label="마스터 키 바꾸기" disabled={saving || !next} onClick={submit}>
            {saving ? '바꾸는 중…' : '바꾸기'}
          </button>
        </div>
        {error && <p className="sec-mod-error" role="alert">{error}</p>}
      </div>
    </section>
  )
}
