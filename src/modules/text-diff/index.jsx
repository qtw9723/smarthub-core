// text-diff 클라이언트 모듈 — 서버 파트 없는 무상태 도구.
import { GitCompare } from 'lucide-react'
import HubPanel from './HubPanel.jsx'

export default { key: 'text-diff', label: '텍스트 비교', description: '두 텍스트를 줄 단위로 비교', icon: GitCompare, HubPanel }
