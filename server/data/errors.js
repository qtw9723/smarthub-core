// 저장소 오류 규약 — 두 구현(외부 supabase · 사내 pg)이 같은 오류를 던지게 정규화한다.
// supabase-js는 { code, message } 객체를, pg는 Error(code, constraint)를 준다. 23505(유일 제약 위반)만 따로 구분한다.

export class UniqueViolationError extends Error {
  constructor(message, constraint) {
    super(message)
    this.name = 'UniqueViolationError'
    this.code = '23505'
    this.constraint = constraint
  }
}

export function toRepoError(err) {
  if (err?.code === '23505') return new UniqueViolationError(err.message ?? 'unique violation', err.constraint)
  if (err instanceof Error) return err
  return Object.assign(new Error(err?.message ?? String(err)), { code: err?.code, details: err?.details })
}
