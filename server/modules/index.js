// 서버 모듈 레지스트리 — 모듈 추가 = 여기 import + 배열 등록만.
// 서버 파트가 없는 모듈도 { key }만으로 등록할 수 있다 — 백오피스가 이
// 레지스트리를 진실의 원천으로 쓰므로, 빠지면 어드민 토글·overview가 조용히 어긋난다.
import chatbotMonitoring from './chatbot-monitoring/index.js'
import mailer from './mailer/index.js'
import grafanaReports from './grafana-reports/index.js'
import sheetToSchema from './sheet-to-schema/index.js'
import docToApi from './doc-to-api/index.js'

const MODULES = [chatbotMonitoring, grafanaReports, mailer, sheetToSchema, docToApi]

export function getModules() { return MODULES }
export function getModule(key) { return MODULES.find(m => m.key === key) ?? null }
