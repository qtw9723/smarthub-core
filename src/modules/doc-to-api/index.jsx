// doc-to-api 클라이언트 모듈 계약: { key, label, description, icon, loadPanel }
// 무상태 툴 — SettingsPanel·DB 테이블 없음. 서버 파트는 프록시 라우터 하나뿐.
//
// HubPanel을 정적 import하지 않고 loadPanel로 노출한다: 이 패널은 pdfjs-dist를
// 정적 의존하는 파일을 끌어오므로, 정적 import하면 문서 도구를 쓰지 않는
// 허브 사용자까지 메인 청크에서 그 무게를 받는다. HubPage가 React.lazy로 로드한다.
import { FileJson } from 'lucide-react'

export default {
  key: 'doc-to-api',
  label: '문서 → API 생성',
  description: 'API 문서에서 import용 API 정의 JSON 생성',
  icon: FileJson,
  loadPanel: () => import('./HubPanel.jsx'),
  // 여러 모듈 중 유일하게 호출이 **다른 프로젝트에 청구**된다(상류 LLM 파싱 서비스).
  // 보안 레벨 L2(shared/securityPolicy.js) — 백오피스가 공개 허브와의 조합을 경고한다.
  // 서버 방어는 server/modules/doc-to-api/router.js의 관문 셋.
  // surface 없음: 패널이 SmartHub 테마 토큰으로 직접 그리고 자기 셸(.app + AppHeader)을
  // 포함한다 — 다른 모듈과 동일한 계약이다.
}
