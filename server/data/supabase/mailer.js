// 메일러 저장소(외부, supabase-js) — mailer 라우터·overview·admin activity·스크립트의 쿼리를 그대로 옮겼다.
// 스토리지(첨부 파일 바이트)는 이 범위 밖이다(라우터·smtp에 그대로).
import { supabaseClient } from './client.js'
import { toRepoError } from '../errors.js'

const rows = ({ data, error }) => { if (error) throw toRepoError(error); return data ?? [] }
const first = ({ data, error }) => { if (error) throw toRepoError(error); return data?.[0] ?? null }
function oneOrNull({ data, error }) {
  if (error && error.code !== 'PGRST116') throw toRepoError(error)
  return data ?? null
}

export async function listJobs(hubId) {
  return rows(await supabaseClient().from('mail_jobs').select('*').eq('hub_id', hubId)
    .order('sort_order', { ascending: true }).order('created_at', { ascending: false }))
}

export async function listJobSummaries(hubId) {
  return rows(await supabaseClient().from('mail_jobs').select('id, name, is_active').eq('hub_id', hubId))
}

export async function listActiveJobs(hubId) {
  return rows(await supabaseClient().from('mail_jobs').select('*').eq('hub_id', hubId).eq('is_active', true))
}

export async function listAllJobNames() {
  return rows(await supabaseClient().from('mail_jobs').select('id, hub_id, name'))
}

export async function getJob(hubId, id) {
  return oneOrNull(await supabaseClient().from('mail_jobs').select('*').eq('id', id).eq('hub_id', hubId).single())
}

export async function createJob(hubId, fields) {
  const { data, error } = await supabaseClient().from('mail_jobs').insert({ hub_id: hubId, ...fields }).select().single()
  if (error) throw toRepoError(error)
  return data
}

export async function updateJob(hubId, id, patch) {
  return first(await supabaseClient().from('mail_jobs').update(patch).eq('id', id).eq('hub_id', hubId).select())
}

export async function deleteJob(hubId, id) {
  return rows(await supabaseClient().from('mail_jobs').delete().eq('id', id).eq('hub_id', hubId).select('id')).length > 0
}

// jsonb 포함 검사는 JSON 문자열로 넘긴다. supabase-js는 배열을 Postgres 배열 리터럴(cs.{…})로 바꿔서,
// 예전 코드(.contains('attachments', [{ path }]))는 jsonb 컬럼에 "invalid input syntax for type json"으로 늘 실패했다
// — 오류를 무시해서 구 경로(2단) 첨부 삭제가 늘 403이던 버그. 계약 테스트가 찾았다(2026-11-09).
export async function hubHasAttachmentPath(hubId, path) {
  return rows(await supabaseClient().from('mail_jobs').select('id').eq('hub_id', hubId)
    .contains('attachments', JSON.stringify([{ path }])).limit(1)).length > 0
}

/** 발송 슬롯 선점(CAS) — job.last_sent_at이 그대로일 때만 갱신. 다른 tick이 먼저 선점했으면 null. */
export async function claimJobSend(hubId, job, nowIso) {
  let q = supabaseClient().from('mail_jobs')
    .update({ last_sent_at: nowIso, send_count: job.send_count + 1 })
    .eq('id', job.id).eq('hub_id', hubId)
  q = job.last_sent_at == null ? q.is('last_sent_at', null) : q.eq('last_sent_at', job.last_sent_at)
  return first(await q.select())
}

export async function listRecentSends(jobIds, limit) {
  if (!jobIds.length) return []
  return rows(await supabaseClient().from('send_log').select('job_id, ok, sent_at')
    .in('job_id', jobIds).order('sent_at', { ascending: false }).limit(limit))
}

export async function listSendEvents(jobIds, limit) {
  if (!jobIds.length) return []
  return rows(await supabaseClient().from('send_log').select('job_id, ok, error, sent_at')
    .in('job_id', jobIds).order('sent_at', { ascending: false }).limit(limit))
}

export async function insertSendLog({ job_id, ok, error: err }) {
  const { error } = await supabaseClient().from('send_log').insert({ job_id, ok, error: err })
  if (error) throw toRepoError(error)
}

export async function listSenders(hubId) {
  return rows(await supabaseClient().from('sender_accounts').select('id, email, created_at').eq('hub_id', hubId).order('created_at', { ascending: true }))
}

export async function createSender(hubId, { email, app_password }) {
  const { data, error } = await supabaseClient().from('sender_accounts').insert({ hub_id: hubId, email, app_password }).select('id, email, created_at').single()
  if (error) throw toRepoError(error)
  return data
}

export async function deleteSender(hubId, id) {
  return rows(await supabaseClient().from('sender_accounts').delete().eq('id', id).eq('hub_id', hubId).select()).length > 0
}

export async function getSender(hubId, id) {
  return oneOrNull(await supabaseClient().from('sender_accounts').select('*').eq('id', id).eq('hub_id', hubId).single())
}

/** 허브와 무관하게 가장 먼저 등록된 발신 계정 — 챗봇 점검 알림·워크플로 실패 알림용. */
export async function getDefaultSender() {
  return rows(await supabaseClient().from('sender_accounts').select('email, app_password').order('created_at', { ascending: true }).limit(1))[0] ?? null
}
