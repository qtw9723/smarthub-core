# SmartHub Core

팀(허브) × 자동화 모듈을 한 곳에서 관리하는 사내 도구의 **핵심 발췌본**입니다.
직접 쓰려고 만든 도구에서 구조만 덜어냈고, 회사·고객 정보와 사내 전용 모듈은 포함하지 않습니다.

> **데모**: 실제 화면을 가짜 백엔드로 띄운 것입니다(실운영 아님).
> **포함**: 허브×모듈 구조, 두 에디션(외부/사내) 드라이버, 챗봇 점검 모듈 1개, 백오피스.
> **제외**: 그 밖의 업무 모듈, 배포 매니페스트, 사내 문서.

## 구조

```
허브(팀)  ─ 한 팀이 쓰는 작업 공간. hub_id로 데이터가 갈린다
 └ 모듈(기능) ─ 허브마다 켜고 끈다(hub_features 매트릭스). 모듈 추가 = 레지스트리 한 줄
백오피스(/admin) ─ 허브 생성·모듈 토글·보안 레벨·활동 요약
```

- **모듈 레지스트리**: 서버 `server/modules/index.js`, 화면 `src/modules/index.js`. 백오피스는 레지스트리를 순회하므로 모듈을 등록하면 토글·요약·보안 표에 자동으로 나타납니다.
- **허브 비밀번호**: 허브마다 따로 건다. 모듈의 보안 레벨(`shared/securityPolicy.js`, L0~L3)이 L2 이상이면 비밀번호 없는 허브에서 켤 때 확인을 먼저 묻는다.
- **모듈 예시**: `chatbot-monitoring` — 챗봇 시나리오를 정시에 돌려 실패를 기록하고, 메일로 알린다.

## 한 코드, 두 에디션

같은 코드가 두 환경에서 돕니다. 차이는 **드라이버**에만 있습니다.

| | 외부 에디션 | 사내 에디션 |
|---|---|---|
| 호스팅 | Vercel + Supabase | k8s + Postgres |
| 데이터 | `server/data/supabase` | `server/data/pg` |
| 점검 러너 | GitHub Actions | k8s Job (`server/editions/internal`) |

데이터 계층은 `server/data/contract`의 계약 테스트를 두 드라이버가 같이 통과해야 합니다.

## 실행

```bash
npm install
cp .env.example .env     # 값 채우기
npm run dev              # 화면(5173) + API(3001)
npm test                 # vitest
npm run lint && npm run build
```

DB는 `db/migrations`의 SQL을 `npm run migrate`로 적용합니다(`db/README.md` 참고).

## 스택

Express · React 19 · Vite · Tailwind 4 · Playwright(점검 러너) · vitest

## 라이선스

MIT — [LICENSE](LICENSE)

## 데모

`npm run build:demo`가 `web/`에 데모 빌드를 만든다(가짜 백엔드, 실운영 아님). 마스터 키는 아무 값이나, 잠긴 허브 `finance`는 `demo`.
