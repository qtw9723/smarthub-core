// src/lib/api/grafana.js — grafana-reports 모듈 클라이언트 (hub + source(환경) 스코프)
import { hubAuthHeaders } from '../auth.js'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

// source가 있으면 &source= 를 붙여 특정 환경으로 스코프. 없으면 서버가 첫 소스로 폴백.
// 허브 스코프 호출이므로 그 허브의 비밀번호를 함께 보낸다(hubAuthHeaders).
// password 인자는 플랫폼 비밀번호(마스터키)이며, 호출부가 넘긴 값이 있으면 그것을 우선한다.
async function req(method, path, password, hub, { body = null, source = null } = {}) {
  const params = new URLSearchParams({ hub })
  if (source) params.set('source', source)
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${BASE}/api/modules/grafana-reports${path}${sep}${params.toString()}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...hubAuthHeaders(hub),
      ...(password ? { 'x-app-password': password } : {}),
    },
    body: body ? JSON.stringify(body) : null,
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
  return res.json()
}

// 리포트/설정/분석 — source로 환경 스코프
export const getReport = (password, hub, source) => req('GET', '/report', password, hub, { source })
export const getSettings = (password, hub, source) => req('GET', '/settings', password, hub, { source })
export const updateSettings = (body, password, hub, source) => req('PUT', '/settings', password, hub, { body, source })
export const analyzeNow = (password, hub, source) => req('POST', '/analyze', password, hub, { source })

// 로그 유형 — source로 환경 스코프
export const getLogTypes = (password, hub, source) => req('GET', '/log-types', password, hub, { source })
export const getLogType = (id, password, hub, source) => req('GET', `/log-types/${id}`, password, hub, { source })
export const updateLogType = (id, body, password, hub, source) => req('PATCH', `/log-types/${id}`, password, hub, { body, source })
export const deleteLogType = (id, password, hub, source) => req('DELETE', `/log-types/${id}`, password, hub, { source })
export const updateLogRun = (runId, body, password, hub, source) => req('PATCH', `/log-type-runs/${runId}`, password, hub, { body, source })
export const testQuery = (body, password, hub, source) => req('POST', '/test-query', password, hub, { body, source })

// 소스(환경) 관리
export const getSources = (password, hub) => req('GET', '/sources', password, hub)
export const createSource = (body, password, hub) => req('POST', '/sources', password, hub, { body })
export const updateSource = (id, body, password, hub) => req('PUT', `/sources/${id}`, password, hub, { body })
export const deleteSource = (id, password, hub) => req('DELETE', `/sources/${id}`, password, hub)
