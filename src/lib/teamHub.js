// src/lib/teamHub.js — 팀 주소(cs.smarthub.example.com 등)로 열렸으면 그 허브 키, 아니면 null.
// 서버(server/static.js)가 index.html에 심은 <meta name="smarthub-team-hub">를 읽는다 — 팀 주소 판단은 서버 한 곳에서만.
export function teamHub() {
  if (typeof document === 'undefined') return null
  return document.querySelector('meta[name="smarthub-team-hub"]')?.getAttribute('content') || null
}
