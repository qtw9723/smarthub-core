// 백오피스 "보안 정책" 영역 — 레벨 정의 표 + 모듈별 레벨 조정.
// 레벨은 모듈 단위이고, 관리자(마스터 키)만 여기서 바꾼다. 허브 사용자는 바꿀 수 없다.
// 기본보다 낮추면 사유가 필요하고(서버도 검증), 올려서 공개 허브가 새로 위반이 되면 저장 전에 몇 곳인지 묻는다.
import { useState } from 'react'
import { getModules } from '../../modules/index.js'
import { LEVELS, LEVEL_INFO, levelRank, newViolationCount, securityReasonOf } from '../../lib/securityPolicy.js'
import ConfirmDialog from '../shared/ConfirmDialog.jsx'

const labelOf = (key) => getModules().find(m => m.key === key)?.label ?? key

/**
 * @param {{ modules: {key, defaultLevel, level, reason}[], entries: {hub, features}[],
 *   levelMap: Record<string,string>, state: 'loading'|'ok'|'error',
 *   onSave: (key: string, body: {level: string, reason: string}) => Promise<void> }} props
 */
export default function SecurityPolicySection({ modules, entries, levelMap, state, onSave }) {
  const [drafts, setDrafts] = useState({}) // key -> { level, reason } (수정 중인 값)
  const [errors, setErrors] = useState({}) // key -> 안내 문구
  const [savingKey, setSavingKey] = useState(null)
  const [confirmRaise, setConfirmRaise] = useState(null) // { key, level, reason, count }
  const locked = state !== 'ok'

  const draftOf = (m) => drafts[m.key] ?? { level: m.level, reason: m.reason ?? '' }
  const setDraft = (key, patch) => {
    setDrafts(prev => ({ ...prev, [key]: { ...draftOf(modules.find(m => m.key === key)), ...patch } }))
    setErrors(prev => ({ ...prev, [key]: null }))
  }

  const commit = async (key, level, reason) => {
    setSavingKey(key)
    try {
      await onSave(key, { level, reason })
      setDrafts(prev => { const n = { ...prev }; delete n[key]; return n })
    } catch {
      setErrors(prev => ({ ...prev, [key]: '저장하지 못했습니다' }))
    } finally {
      setSavingKey(null)
    }
  }

  const save = (m) => {
    const { level, reason } = draftOf(m)
    const trimmed = reason.trim()
    if (levelRank(level) < levelRank(m.defaultLevel) && !trimmed) {
      setErrors(prev => ({ ...prev, [m.key]: '기본보다 낮추려면 사유를 입력하세요' }))
      return
    }
    // 사유는 기본과 다를 때만 보낸다(낮출 때 필수, 올릴 때 선택). 방향이 바뀌면 칸을 비우므로 예전 사유가 실려 가지 않는다.
    const sent = level !== m.defaultLevel ? trimmed : ''
    const count = newViolationCount(entries, levelMap, m.key, level)
    if (count > 0) { setConfirmRaise({ key: m.key, level, reason: sent, count }); return }
    commit(m.key, level, sent)
  }

  return (
    <section className="sec" data-testid="security-policy">
      <div className="sec-head">
        <h2>보안 정책</h2>
        <span className="hint">모듈 단위 레벨 · L2부터 허브 비밀번호 필요 · 경고와 확인만(막지 않음)</span>
      </div>
      <div className="panel sec-policy">
        {state === 'error' && <p className="security-load-error">보안 레벨을 불러오지 못해 기본값으로 보여 주고 있습니다 — 조정은 잠시 막습니다.</p>}

        <table className="sec-levels">
          <thead><tr><th>레벨</th><th>이름</th><th>노출·오용되면</th><th>허브 요구 조건</th></tr></thead>
          <tbody>
            {LEVELS.map(l => (
              <tr key={l}><td className="tnum">{l}</td><td>{LEVEL_INFO[l].name}</td><td>{LEVEL_INFO[l].definition}</td><td>{LEVEL_INFO[l].requirement}</td></tr>
            ))}
          </tbody>
        </table>

        <div className="sec-mods">
          {modules.map(m => {
            const label = labelOf(m.key)
            const d = draftOf(m)
            const lowering = levelRank(d.level) < levelRank(m.defaultLevel)
            const adjusted = d.level !== m.defaultLevel
            const changed = d.level !== m.level || (adjusted && d.reason !== (m.reason ?? ''))
            return (
              <div className="sec-mod" key={m.key}>
                <div className="sec-mod-name">
                  <b>{label}</b>
                  {levelRank(m.level) < levelRank(m.defaultLevel) && (
                    <span className="sec-badge" data-testid={`below-default-${m.key}`} title={m.reason ?? ''}>기본보다 낮음</span>
                  )}
                  <span className="sec-mod-reason">기본 {m.defaultLevel} — {securityReasonOf(m.key)}</span>
                  {m.level !== m.defaultLevel && (
                    <span className="sec-mod-reason" data-testid={`adjusted-${m.key}`}>{securityReasonOf(m.key, m)}</span>
                  )}
                </div>
                <div className="sec-mod-ctl">
                  <select
                    aria-label={`${label} 보안 레벨`} value={d.level} disabled={locked}
                    onChange={e => {
                      const level = e.target.value
                      // 기본 기준 방향(올림·내림·기본)이 바뀌면 사유를 비운다 — 낮출 때 쓴 사유가 올린 레벨에 붙지 않게.
                      const dir = (l) => Math.sign(levelRank(l) - levelRank(m.defaultLevel))
                      setDraft(m.key, dir(level) === dir(d.level) ? { level } : { level, reason: '' })
                    }}
                  >
                    {LEVELS.map(l => <option key={l} value={l}>{l} {LEVEL_INFO[l].name}{l === m.defaultLevel ? ' (기본)' : ''}</option>)}
                  </select>
                  {adjusted && (
                    <input
                      className="search-input" aria-label={`${label} 조정 사유`} placeholder={lowering ? '기본보다 낮추는 사유' : '올리는 사유(선택)'}
                      value={d.reason} maxLength={200} disabled={locked}
                      onChange={e => setDraft(m.key, { reason: e.target.value })}
                    />
                  )}
                  <button
                    type="button" className="btn" aria-label={`${label} 레벨 저장`}
                    disabled={locked || !changed || savingKey === m.key} onClick={() => save(m)}
                  >
                    {savingKey === m.key ? '저장 중…' : '저장'}
                  </button>
                </div>
                {errors[m.key] && <p className="sec-mod-error" role="alert">{errors[m.key]}</p>}
              </div>
            )
          })}
        </div>
      </div>

      {confirmRaise && (
        <ConfirmDialog
          title="레벨을 올리면 정책 위반이 생깁니다"
          message={`${labelOf(confirmRaise.key)}을(를) ${confirmRaise.level}(${LEVEL_INFO[confirmRaise.level].name})로 올리면 공개 허브 ${confirmRaise.count}곳이 정책 위반이 됩니다(확인된 예외가 풀리는 허브 포함). 계속할까요?`}
          confirmLabel="계속" danger
          onConfirm={() => { const c = confirmRaise; setConfirmRaise(null); commit(c.key, c.level, c.reason) }}
          onCancel={() => setConfirmRaise(null)}
        />
      )}
    </section>
  )
}
