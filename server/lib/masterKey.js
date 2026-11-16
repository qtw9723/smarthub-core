// 백오피스 마스터 키 — 백오피스(/admin)·허브 목록을 열고, 모든 허브 API를 통과시키는 키.
//
// 백오피스에서 바꾼 키는 DB(app_settings.master_key_hash, scrypt 해시)에 둔다. 그 값이 있으면 그것만 통하고,
// 없으면 서버 설정값 APP_PASSWORD를 쓴다(처음 배포·바꾼 적 없음). 잊었을 때는 그 행을 지우면 APP_PASSWORD로 돌아간다
// (docs/internal-edition.md "마스터 키").
// DB를 읽지 못하면(마이그레이션 전·장애) APP_PASSWORD로 확인한다 — 백오피스가 잠겨 복구조차 못 하는 일을 막는다.
import { createHash } from 'node:crypto'
import { repos } from '../data/index.js'
import { hashPassword, verifyPassword } from './hubPassword.js'

export const MASTER_KEY_SETTING = 'master_key_hash'
export const MIN_LENGTH = 8
export const MAX_LENGTH = 200
const HASH_TTL_MS = 30_000

// 저장된 해시를 잠깐 기억한다(요청마다 DB를 읽지 않게). 검증 결과도 해시별로 기억한다 — scrypt는 일부러 느리다.
let cached = { at: 0, hash: undefined }
let verified = new Map()

async function storedHash() {
  if (cached.hash !== undefined && Date.now() - cached.at < HASH_TTL_MS) return cached.hash
  let hash = null
  try {
    hash = await repos.settings.get(MASTER_KEY_SETTING)
  } catch {
    hash = null // 읽지 못하면 APP_PASSWORD로(위 설명). 기억하지 않는다 — 다음 요청에서 다시 읽는다.
    return hash
  }
  if (hash !== cached.hash) verified = new Map()
  cached = { at: Date.now(), hash }
  return hash
}

const fingerprint = (s) => createHash('sha256').update(s).digest('hex')

/** @returns {Promise<boolean>} */
export async function isMasterKey(candidate) {
  if (typeof candidate !== 'string' || candidate === '') return false
  const hash = await storedHash()
  if (!hash) {
    const env = process.env.APP_PASSWORD
    return !!env && candidate === env
  }
  const fp = fingerprint(candidate)
  if (!verified.has(fp)) verified.set(fp, verifyPassword(candidate, hash))
  return verified.get(fp)
}

/** 새 마스터 키를 해시로 저장하고 바로 반영한다. */
export async function setMasterKey(plain) {
  if (typeof plain !== 'string' || plain.length < MIN_LENGTH) throw new Error(`마스터 키는 ${MIN_LENGTH}자 이상이어야 합니다`)
  if (plain.length > MAX_LENGTH) throw new Error(`마스터 키는 ${MAX_LENGTH}자 이하여야 합니다`)
  await repos.settings.set(MASTER_KEY_SETTING, hashPassword(plain))
  cached = { at: 0, hash: undefined }
  verified = new Map()
}

/** 테스트 전용 — 기억해 둔 해시·검증 결과를 비운다. */
export function resetMasterKeyCacheForTest() {
  cached = { at: 0, hash: undefined }
  verified = new Map()
}
