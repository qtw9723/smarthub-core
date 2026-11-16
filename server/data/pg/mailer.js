// 메일러 저장소(사내, pg) — supabase 구현과 같은 함수·같은 결과(contract/mailer.db.test.js).
import { query } from './pool.js'
import { insertSql, setClause } from './sql.js'

const JOB_COLS = ['hub_id', 'name', 'subject', 'body', 'recipients', 'sender', 'interval_minutes', 'is_active', 'last_sent_at',
  'send_count', 'use_index', 'attachments', 'sort_order', 'sender_account_id', 'body_format']
// jsonb 컬럼은 문자열로 넘긴다 — node-pg는 JS 배열을 Postgres 배열 리터럴로 바꾸기 때문이다(text[]는 그게 맞다).
const jsonb = (row) => (row.attachments === undefined ? row : { ...row, attachments: JSON.stringify(row.attachments) })
const all = async (sql, params) => (await query(sql, params)).rows
const one = async (sql, params) => (await query(sql, params)).rows[0] ?? null

export const listJobs = (hubId) => all('select * from mail_jobs where hub_id = $1 order by sort_order asc, created_at desc', [hubId])
export const listJobSummaries = (hubId) => all('select id, name, is_active from mail_jobs where hub_id = $1', [hubId])
export const listActiveJobs = (hubId) => all('select * from mail_jobs where hub_id = $1 and is_active = true', [hubId])
export const listAllJobNames = () => all('select id, hub_id, name from mail_jobs')
export const getJob = (hubId, id) => one('select * from mail_jobs where id = $1 and hub_id = $2', [id, hubId])

export async function createJob(hubId, fields) {
  const q = insertSql('mail_jobs', jsonb({ hub_id: hubId, ...fields }), JOB_COLS)
  return (await query(q.text, q.values)).rows[0]
}

export async function updateJob(hubId, id, patch) {
  const set = setClause(jsonb(patch), JOB_COLS, 'updateJob')
  const n = set.values.length
  return one(`update mail_jobs set ${set.text} where id = $${n + 1} and hub_id = $${n + 2} returning *`, [...set.values, id, hubId])
}

export const deleteJob = async (hubId, id) => (await query('delete from mail_jobs where id = $1 and hub_id = $2', [id, hubId])).rowCount > 0

export async function hubHasAttachmentPath(hubId, path) {
  return (await all('select id from mail_jobs where hub_id = $1 and attachments @> $2::jsonb limit 1', [hubId, JSON.stringify([{ path }])])).length > 0
}

/** 발송 슬롯 선점(CAS) — job.last_sent_at이 그대로일 때만 갱신. 다른 tick이 먼저 선점했으면 null. */
export function claimJobSend(hubId, job, nowIso) {
  return one(`update mail_jobs set last_sent_at = $1, send_count = $2
    where id = $3 and hub_id = $4 and last_sent_at is not distinct from $5::timestamptz returning *`,
  [nowIso, job.send_count + 1, job.id, hubId, job.last_sent_at ?? null])
}

export async function listRecentSends(jobIds, limit) {
  if (!jobIds.length) return []
  return all('select job_id, ok, sent_at from send_log where job_id = any($1::uuid[]) order by sent_at desc limit $2', [jobIds, limit])
}

export async function listSendEvents(jobIds, limit) {
  if (!jobIds.length) return []
  return all('select job_id, ok, error, sent_at from send_log where job_id = any($1::uuid[]) order by sent_at desc limit $2', [jobIds, limit])
}

export async function insertSendLog({ job_id, ok, error }) {
  await query('insert into send_log (job_id, ok, error) values ($1, $2, $3)', [job_id, ok, error])
}

export const listSenders = (hubId) => all('select id, email, created_at from sender_accounts where hub_id = $1 order by created_at asc', [hubId])

export function createSender(hubId, { email, app_password }) {
  return one('insert into sender_accounts (hub_id, email, app_password) values ($1, $2, $3) returning id, email, created_at', [hubId, email, app_password])
}

export const deleteSender = async (hubId, id) => (await query('delete from sender_accounts where id = $1 and hub_id = $2', [id, hubId])).rowCount > 0
export const getSender = (hubId, id) => one('select * from sender_accounts where id = $1 and hub_id = $2', [id, hubId])
export const getDefaultSender = () => one('select email, app_password from sender_accounts order by created_at asc limit 1')
