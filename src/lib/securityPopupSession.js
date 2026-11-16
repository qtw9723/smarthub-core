// 백오피스 보안 정책 팝업(SecurityViolationPopup)의 "이번 세션에 이미 봤다" 기록.
// sessionStorage는 사생활 보호 모드 등에서 접근만으로 던질 수 있다 — 그때는 매번 띄운다.
const POPUP_KEY = 'smarthub.securityPopupSeen'

export function securityPopupSeen() {
  try { return sessionStorage.getItem(POPUP_KEY) === '1' } catch { return false }
}

export function markSecurityPopupSeen() {
  try { sessionStorage.setItem(POPUP_KEY, '1') } catch { /* 막힌 브라우저 — 다음 진입 때 또 뜬다 */ }
}
