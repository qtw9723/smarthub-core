// sheet-to-schema 서버 모듈 — 계약: { key }만.
//
// 이 모듈은 서버 파트가 전혀 없다(100% 브라우저 내 변환 — API 라우터·DB 테이블·
// 스케줄 없음). 그래서 apiRouter도 overview도 두지 않는다:
//   - server/index.js의 `if (m.apiRouter)` 가드가 마운트를 건너뛴다.
//   - server/routes/admin.js:144가 overview를 옵셔널로 다뤄 { summary: {} }를 넣는다.
//
// 그럼에도 여기 등록하는 이유는 백오피스가 **서버 레지스트리**를 진실의 원천으로 쓰기
// 때문이다. 등록하지 않으면
//   ① PUT /api/admin/hubs/:hub/features/sheet-to-schema 가 'unknown module' 400으로 거부되고,
//   ② GET /api/admin/overview 의 features 배열에 절대 나타나지 않아 어드민 칩이 항상
//      OFF로 보이는데, /hub/:hubKey는 hub_features를 직접 읽어 도구를 보여준다
//      (두 제어 화면이 영구히 어긋난다).
export default { key: 'sheet-to-schema' }
