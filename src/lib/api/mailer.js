// src/lib/api/mailer.js — mailer 모듈 클라이언트 (hub 스코프)
import { hubAuthHeaders } from '../auth.js'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

// 허브 스코프 호출이므로 그 허브의 비밀번호를 함께 보낸다(hubAuthHeaders).
// password 인자는 플랫폼 비밀번호(마스터키)이며, 호출부가 넘긴 값이 있으면 그것을 우선한다.
async function request(method, path, body, password, hub) {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${BASE}/api/modules/mailer${path}${sep}hub=${encodeURIComponent(hub)}`, {
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
  return method === 'DELETE' ? null : res.json()
}

export const getJobs = (pw, hub) => request('GET', '/jobs', null, pw, hub)
export const createJob = (job, pw, hub) => request('POST', '/jobs', job, pw, hub)
export const updateJob = (id, patch, pw, hub) => request('PATCH', `/jobs/${id}`, patch, pw, hub)
export const deleteJob = (id, pw, hub) => request('DELETE', `/jobs/${id}`, null, pw, hub)
export const reorderJobs = (ids, pw, hub) =>
  Promise.all(ids.map((id, i) => request('PATCH', `/jobs/${id}`, { sort_order: i }, pw, hub)))

export const getSenders = (pw, hub) => request('GET', '/senders', null, pw, hub)
export const createSender = (data, pw, hub) => request('POST', '/senders', data, pw, hub)
export const deleteSender = (id, pw, hub) => request('DELETE', `/senders/${id}`, null, pw, hub)

// 첨부 인가는 서버를 지난다(ROADMAP v0.5.0). 바이트는 브라우저 → Storage로 직접 가고,
// 서버는 허브를 확인한 뒤 경로와 서명 토큰만 내준다. 경로는 서버가 정한다.
export const signUpload = (meta, pw, hub) => request('POST', '/attachments/sign-upload', meta, pw, hub)
export const deleteAttachment = (path, pw, hub) => request('DELETE', '/attachments', { path }, pw, hub)
