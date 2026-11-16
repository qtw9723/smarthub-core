# DB 마이그레이션

SmartHub는 두 DB를 쓴다 — **외부**(Vercel 배포, Supabase Postgres)와 **사내**(사내 k8s, 자체 Postgres).
데이터는 각자 따로 관리하고, **스키마는 같은 마이그레이션 파일을 같은 순서로** 적용해 맞춘다.

## 폴더

| 폴더 | 적용 대상 | 넣는 것 |
|---|---|---|
| `migrations/common/` | 외부 + 사내 | 일반 Postgres SQL만 |
| `migrations/external/` | 외부만 | Supabase 전용: RLS·정책(anon 등), Storage 정책, pg_cron 등록 |

common 금지(`npm run lint:migrations`, CI가 막는다): `auth.` `storage.` `cron.` `net.`, 역할 `anon`·`authenticated`·`service_role`,
`pgcrypto`·`uuid-ossp` 외 `CREATE EXTENSION`.

- 파일명 `<YYYYMMDDHHMMSS>_<이름>.sql`. 버전은 두 폴더를 통틀어 유일해야 한다.
- **이미 적용된 파일은 고치지 않는다** — 러너가 체크섬 불일치로 멈춘다. 고칠 일이 있으면 새 파일.
- 새 테이블은 `ownedTables.mjs`에도 넣고, 외부 DB용 RLS는 `external/`에 따로.
- 기준선: `common/20261110000000_baseline.sql`(2026-11-09 외부 DB 스키마).

## 적용

각 DB의 `schema_migrations` 표가 무엇을 적용했는지 기록한다.

```bash
npm run migrate -- --status        # 상태 (applied / pending / mismatched / unknown)
npm run migrate -- --dry-run       # 적용할 목록만
npm run migrate                    # 적용 (DATABASE_URL 대상)
```

- 사내: `SMARTHUB_EDITION=internal` → `common`만. 배포 시 initContainer가 실행한다.
- 외부: 기본값 → `common`+`external`. **외부 DB 쓰기는 사용자가 직접 실행**한다. 접속 문자열 없이 Management API로:
  `node scripts/migrate-external.mjs --dry-run` → `node scripts/migrate-external.mjs`(미적용분을 한 트랜잭션으로 + 기록).
  접속 문자열(Session pooler)이 있으면 `DATABASE_URL=… npm run migrate`도 된다.
  외부 `DATABASE_URL`은 **Session pooler(5432) 또는 직접 접속**만 — transaction pooler(6543)는 러너가 거부한다(세션 advisory lock).
- 파일 안에 `begin;`·`commit;`·`rollback;`·`concurrently`를 쓰지 않는다 — 러너가 파일마다 트랜잭션을 열고, 이런 파일이 있으면 아무것도 적용하지 않는다.
- 두 DB 비교: `DATABASE_URL=<A> DIFF_DATABASE_URL=<B> npm run migrate -- --diff` (소유 테이블 컬럼·인덱스·제약, RLS 제외).

## 검증

- `npm run test:db` — 러너 실DB 테스트(로컬: `docker run -d --rm --name smarthub-pg-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17`,
  `TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres`). 기본 `npm test`에는 들어가지 않는다.
- CI(`migrations` job)가 매 PR마다 빈 Postgres 17에 common을 처음부터 적용하고, 재적용 0건을 확인한다.
