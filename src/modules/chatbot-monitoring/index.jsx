// chatbot-monitoring 클라이언트 모듈 계약: { key, label, icon, HubPanel, SettingsPanel }
import { Bot } from 'lucide-react'
import HubPanel from './HubPanel.jsx'
import SettingsPanel from './SettingsPanel.jsx'

export default {
  key: 'chatbot-monitoring',
  label: '챗봇 모니터링',
  description: '챗봇 일일 시나리오 체크',
  icon: Bot,
  HubPanel,
  SettingsPanel,
}
