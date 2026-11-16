// cron-explain 클라이언트 모듈 — 서버 파트 없는 무상태 도구.
import { Clock } from 'lucide-react'
import HubPanel from './HubPanel.jsx'

export default { key: 'cron-explain', label: 'Cron 해석기', description: '스케줄 표현식을 읽고 다음 실행 시각 확인', icon: Clock, HubPanel }
