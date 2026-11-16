# 저장소 계층 (`server/data/`)

라우터·미들웨어·스크립트는 DB를 직접 부르지 않고 `repos`만 쓴다. 같은 함수가 에디션별로 두 벌 있다.

| 폴더 | 에디션 | 연결 |
|---|---|---|
| `supabase/` | 외부(Vercel, 기본) | supabase-js 서비스 롤(`server/db.js` → `SUPABASE_URL`) |
| `pg/` | 사내(`SMARTHUB_EDITION=internal`) | `pg` + SQL(`DATABASE_URL`) |

`index.js`가 에디션에 맞는 쪽만 import한다.

## 규약

- 단건 없음 `null` · 목록 없음 `[]` · 삭제 `boolean` · 수정 `row|null` · DB 오류 throw · 유일 제약 위반 `UniqueViolationError`.
- 응답 모양(컬럼·타입)은 두 구현이 같다 — pg 풀이 타임스탬프·날짜·bigint를 PostgREST와 같은 모양으로 바꾼다(`pg/pool.js`).
- pg에서 컬럼 이름은 허용 목록으로 거른 뒤에만 SQL에 넣는다(`pg/sql.js`). 값은 항상 `$n`. jsonb 컬럼은 `JSON.stringify`.
- 오류를 무시하던 기존 호출자는 호출하는 쪽에서 `.catch(() => null)` 등으로 이전 결과를 보존한다.
- 스토리지(첨부 바이트)는 아직 `server/db.js`의 `.storage`를 직접 쓴다(3/4 첨부 드라이버).

## 새 함수를 추가할 때

1. `contract/<영역>.db.test.js`에 시나리오를 먼저 쓴다(정상·없음·허브 범위·위반). 두 구현에 같이 돈다.
2. `supabase/<영역>.js`와 `pg/<영역>.js` 둘 다 구현한다. 한쪽만 있으면 `contract/parity.test.js`가 실패한다.
3. 저장소 밖에 `.from('테이블')`을 새로 쓰면 `parity.test.js`의 직접 호출 검사가 실패한다.

실행: `contract/README.md`(로컬 Postgres 17 + PostgREST, CI는 `migrations` job).
