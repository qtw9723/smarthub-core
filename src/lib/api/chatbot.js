// src/lib/api/chatbot.js
import { hubAuthHeaders } from '../auth.js'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''
const DEFAULT_HUB = 'delivery'

// 허브 스코프 호출이므로 그 허브의 비밀번호를 함께 보낸다(hubAuthHeaders).
// password 인자는 플랫폼 비밀번호(마스터키)이며, 호출부가 넘긴 값이 있으면 그것을 우선한다.
async function request(method, path, body = null, password, hub = DEFAULT_HUB) {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${BASE}/api/chatbot${path}${sep}hub=${encodeURIComponent(hub)}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...hubAuthHeaders(hub),
      ...(password ? { 'x-app-password': password } : {}),
    },
    body: body ? JSON.stringify(body) : null,
  })
  if (res.status === 401) throw new Error('UNAUTHORIZED')
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  if (method === 'DELETE') return null
  return res.json()
}

// hub 인자는 선택(기본 delivery) — 백오피스에서 다른 허브를 대상으로 호출할 때 지정.
export const getBots = (pw, hub) => request('GET', '/bots', null, pw, hub)
export const createBot = (bot, pw, hub) => request('POST', '/bots', bot, pw, hub)
export const updateBot = (id, patch, pw, hub) => request('PATCH', `/bots/${id}`, patch, pw, hub)
export const deleteBot = (id, pw, hub) => request('DELETE', `/bots/${id}`, null, pw, hub)
export const getChatbotSettings = (pw, hub) => request('GET', '/settings', null, pw, hub)
export const updateChatbotSettings = (body, pw, hub) => request('PUT', '/settings', body, pw, hub)
export const renameCategory = (from, to, pw, hub) => request('PATCH', '/categories', { from, to }, pw, hub)
export const deleteCategory = (name, pw, hub) => request('DELETE', '/categories', { name }, pw, hub)
// target: { botId } 단건 / { category } 그룹 / 없으면 전체
export const runCheck = (target, pw, hub) => {
  const body = target?.botId ? { bot_id: target.botId } : target?.category ? { category: target.category } : {}
  return request('POST', '/run-check', body, pw, hub)
}
