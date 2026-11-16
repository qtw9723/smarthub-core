# 저장소 계약 테스트

`server/data/`의 두 구현(외부 supabase · 사내 pg)이 같은 입력에 같은 결과를 내는지 **실제 Postgres**로 검증한다.
supabase 구현은 같은 DB 앞에 띄운 PostgREST(supabase-js가 실제로 말하는 서버)를 거친다 — 흉내 낸 클라이언트가 아니라
진짜 정렬·jsonb·유일 제약 의미로 확인하기 위해서다.1.

## 로컬 실행

```bash
docker run -d --rm --name smarthub-pg-test -e POSTGRES_PASSWORD=test -p 55432:5432 postgres:17
docker exec smarthub-pg-test psql -U postgres -c 'create database contract'
docker run -d --rm --name smarthub-pgrst -p 3300:3000 \
  -e PGRST_DB_URI=postgres://postgres:test@host.docker.internal:55432/contract \
  -e PGRST_DB_ANON_ROLE=postgres -e PGRST_DB_SCHEMAS=public \
  -e PGRST_JWT_SECRET=smarthub-contract-test-secret-0123456789abcdef \
  postgrest/postgrest:v12.2.3
TEST_DATABASE_URL=postgres://postgres:test@localhost:55432/postgres npm run test:db
```

- `contract` DB 하나를 공유하고 시나리오마다 소유 테이블을 `truncate`한다. 마이그레이션(common)은 하네스가 적용한다.
- CI는 `migrations` job에서 같은 구성(서비스 컨테이너)으로 돈다.

## 새 저장소 함수를 추가할 때

1. `contract/<영역>.db.test.js`에 시나리오(정상·없음·스코프·위반)를 먼저 쓴다 — `contractSuite`가 두 구현에 돌린다.
2. `supabase/<영역>.js`와 `pg/<영역>.js` 둘 다 구현한다. 한쪽만 추가하면 `parity.test.js`가 실패한다.
