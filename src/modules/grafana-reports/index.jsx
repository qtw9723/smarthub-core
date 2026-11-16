// grafana-reports 클라이언트 모듈 계약: { key, label, icon, HubPanel, SettingsPanel }
import { LineChart } from 'lucide-react'
import HubPanel from './HubPanel.jsx'
import SettingsPanel from './SettingsPanel.jsx'

export default {
  key: 'grafana-reports',
  label: 'Grafana 리포트',
  description: '모니터링 리포트 생성',
  icon: LineChart,
  HubPanel,
  SettingsPanel,
}
