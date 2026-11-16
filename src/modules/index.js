// 클라이언트 모듈 레지스트리 — 모듈 추가 = 여기 import + 배열 등록만.
import chatbotMonitoring from './chatbot-monitoring/index.jsx'
import mailer from './mailer/index.jsx'
import grafanaReports from './grafana-reports/index.jsx'
import sheetToSchema from './sheet-to-schema/index.jsx'
import docToApi from './doc-to-api/index.jsx'

// 모듈 레벨 배열 — getModule이 매번 **같은 객체 참조**를 돌려준다는 점에 HubPage가
// 의존한다(lazyPanelCache 키와 useMemo([mod]) 의존성). 레지스트리를 나중에 리팩터링해
// 호출마다 새 객체를 만들면(map/spread 등) 그 메모가 매 렌더 무효화돼 지연 로드 패널이
// 계속 다시 마운트된다 — 조용히 깨지는 결합이므로 참조 안정성을 유지할 것.
const MODULES = [chatbotMonitoring, grafanaReports, mailer, sheetToSchema, docToApi]

export function getModules() { return MODULES }
export function getModule(key) { return MODULES.find(m => m.key === key) ?? null }
