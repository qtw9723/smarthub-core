// src/lib/clipboard.js — 텍스트 복사. navigator.clipboard는 보안 컨텍스트(https·localhost) 전용이라
// 사내 에디션(사내망 http)에는 없다 — 그때는 숨은 textarea를 골라 execCommand('copy')로 복사한다. 실패하면 던진다.
export async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  try {
    if (!document.execCommand('copy')) throw new Error('copy failed')
  } finally {
    document.body.removeChild(ta)
  }
}
