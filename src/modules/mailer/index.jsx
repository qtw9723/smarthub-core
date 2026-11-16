// mailer 클라이언트 모듈 계약: { key, label, icon, HubPanel, SettingsPanel }
import { Mail } from 'lucide-react'
import HubPanel from './HubPanel.jsx'
import SettingsPanel from './SettingsPanel.jsx'

export default {
  key: 'mailer',
  label: '메일 발송',
  description: '메일 발송 스케줄 관리',
  icon: Mail,
  HubPanel,
  SettingsPanel,
}
