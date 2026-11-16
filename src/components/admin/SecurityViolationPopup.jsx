// 백오피스 진입 팝업 — 보안 정책 위반(L2+ 모듈이 켜진 공개 허브)을 들어오자마자 알린다.
// 막지 않는다: 비밀번호를 설정하러 가거나, "확인함"으로 예외를 남기거나, 닫는다.
// 닫으면 그 브라우저 세션 동안 다시 띄우지 않는다(src/lib/securityPopupSession.js — 상시 경고는 배너·카드가 맡는다).
import { ShieldAlert } from 'lucide-react'
import Modal from '../shared/Modal.jsx'
import { getModules } from '../../modules/index.js'
import { levelLabel, securityReasonOf } from '../../lib/securityPolicy.js'

const labelOf = (key) => getModules().find(m => m.key === key)?.label ?? key

/**
 * @param {{ violations: {hub, required, riskyKeys}[], levelMap: Record<string,string>,
 *   securityRows?: {key, level, reason}[],   // GET /security의 modules — 조정된 레벨의 사유 표시용(없으면 기본 이유)
 *   onSetPassword: (hub) => void, onAck: (hub, required) => void, onClose: () => void }} props
 */
export default function SecurityViolationPopup({ violations, levelMap, securityRows, onSetPassword, onAck, onClose }) {
  return (
    <Modal title="보안 정책 위반 허브가 있습니다" onClose={onClose} maxWidth={560}>
      <p className="form-hint sec-popup-lead">
        비밀번호가 필요한(L2 이상) 모듈이 <b>비밀번호 없는 공개 허브</b>에 켜져 있습니다.
        URL을 아는 누구나 그 모듈을 쓸 수 있습니다.
      </p>
      <ul className="sec-popup-list">
        {violations.map(v => (
          <li key={v.hub.id} className="sec-popup-item">
            <div className="sec-popup-head">
              <ShieldAlert size={14} />
              <b>{v.hub.name}</b>
              <span className="sec-level">요구 {levelLabel(v.required)}</span>
            </div>
            <ul className="sec-popup-mods">
              {v.riskyKeys.map(k => (
                <li key={k}>{labelOf(k)} · {levelLabel(levelMap?.[k])} — {securityReasonOf(k, securityRows?.find(r => r.key === k))}</li>
              ))}
            </ul>
            <div className="sec-popup-actions">
              <button type="button" className="btn btn-primary" onClick={() => onSetPassword(v.hub)}>비밀번호 설정</button>
              <button type="button" className="btn" onClick={() => onAck(v.hub, v.required)}
                title="알고도 공개로 둡니다 — 요구 레벨이 올라가면 다시 경고합니다">
                확인함(공개 유지)
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <button type="button" className="modal-cancel" onClick={onClose}>닫기</button>
      </div>
    </Modal>
  )
}
