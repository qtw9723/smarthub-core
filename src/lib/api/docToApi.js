// src/lib/api/docToApi.js — doc-to-api 모듈 클라이언트.
// 자유형식 문서 추출만 서버를 탄다(OpenAPI는 브라우저 결정론 파서).
// req() 패턴은 src/lib/api/grafana.js와 동일하다.
import { hubAuthHeaders } from '../auth.js'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

/**
 * 자유형식 API 문서 텍스트에서 api_def 배열을 추출한다.
 * @param {string} text
 * @param {string} password  x-app-password
 * @param {string} hub       허브 키
 * @returns {Promise<{ defs: any[] }>}
 */
export async function parseApiDoc(text, password, hub) {
  const params = new URLSearchParams({ hub })
  const res = await fetch(`${BASE}/api/modules/doc-to-api/parse?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...hubAuthHeaders(hub),
      ...(password ? { 'x-app-password': password } : {}),
    },
    body: JSON.stringify({ text }),
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) {
    const body = await res.text()
    let message = body || `HTTP ${res.status}`
    try { message = JSON.parse(body).error ?? message } catch { /* 평문 본문 */ }
    throw new Error(message)
  }
  return res.json()
}
