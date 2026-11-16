// sheet-to-schema 클라이언트 모듈 계약: { key, label, description, icon, loadPanel }
// 무상태 툴 — SettingsPanel·서버 파트·DB 테이블 없음.
//
// HubPanel을 정적 import하지 않고 loadPanel로 노출한다: 이 패널은 xlsx(~430KB)를
// 정적 의존하는 parseExcelFile을 끌어오므로, 정적 import하면 문서 도구를 쓰지 않는
// 허브 사용자까지 메인 청크에서 그 무게를 받는다. HubPage가 React.lazy로 로드한다.
import { FileOutput } from 'lucide-react'

export default {
  key: 'sheet-to-schema',
  label: '엑셀 → 스키마 변환',
  description: '엑셀·CSV 시트를 스키마 JSON과 업로드 CSV로 변환',
  icon: FileOutput,
  loadPanel: () => import('./HubPanel.jsx'),
  // surface 없음: 패널이 SmartHub 테마 토큰으로 직접 그리고 자기 셸(.app + AppHeader)을
  // 포함한다 — 다른 모듈과 동일한 계약이다.
}
