// 사내 에디션 DB 연결 — DATABASE_URL(사내 Postgres). 처음 쓸 때 만든다(외부 에디션에서는 import돼도 연결하지 않는다).
import pg from 'pg'
import { toRepoError } from '../errors.js'

let pool = null

// 값의 모양을 PostgREST(외부 구현)와 맞춘다 — API 응답이 에디션마다 달라지지 않게(contract/types.db.test.js).
//   timestamptz/timestamp → '2026-11-09T08:02:00.123456+00:00' 문자열(pg 기본은 Date, 마이크로초가 잘린다)
//   date → 'YYYY-MM-DD' 문자열(pg 기본은 로컬 자정 Date), bigint → number(id가 2^53 미만)
const iso = (v) => v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')
const types = {
  getTypeParser(oid, format) {
    if (oid === 1184 || oid === 1114) return iso
    if (oid === 1082) return (v) => v
    if (oid === 20) return (v) => Number(v)
    return pg.types.getTypeParser(oid, format)
  },
}
const options = '-c TimeZone=UTC'

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL이 없다(사내 에디션)')
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10, types, options })
  }
  return pool
}

/** @returns {Promise<{ rows: any[], rowCount: number }>} */
export async function query(sql, params = []) {
  try {
    return await getPool().query(sql, params)
  } catch (err) {
    throw toRepoError(err)
  }
}

/** 테스트 전용 — 다른 DB로 바꾸거나 닫는다. */
export async function resetPoolForTest(connectionString) {
  if (pool) await pool.end()
  pool = connectionString ? new pg.Pool({ connectionString, max: 4, types, options }) : null
}
