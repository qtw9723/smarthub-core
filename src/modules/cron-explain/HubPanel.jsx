// cron-explain 모듈 — cron 표현식을 읽어 주고 다음 실행 시각을 보여 준다(브라우저 안에서만).
import { useMemo, useState } from 'react'
import AppHeader from '../../components/shared/AppHeader.jsx'
import { explainCron, nextRuns } from './cron.js'

const PRESETS = [['매일 09:00', '0 9 * * *'], ['5분마다', '*/5 * * * *'], ['평일 18:30', '30 18 * * 1-5'], ['매월 1일 00:00', '0 0 1 * *']]
const fmt = (d) => d.toLocaleString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })

export default function HubPanel() {
  const [expr, setExpr] = useState('0 9 * * 1-5')
  const result = useMemo(() => {
    try { return { text: explainCron(expr), runs: nextRuns(expr, new Date(), 5), error: '' } }
    catch (e) { return { text: '', runs: [], error: e.message } }
  }, [expr])

  return (
    <div className="app">
      <AppHeader toolName="Cron 해석기" />
      <div className="panel-wrap tool-body">
        <label className="form-field">
          <span className="form-label">cron 표현식 (분 시 일 월 요일)</span>
          <input className="form-input tool-mono" value={expr} onChange={e => setExpr(e.target.value)} spellCheck={false} />
        </label>
        <div className="tool-bar">
          {PRESETS.map(([label, v]) => <button key={v} className="btn" onClick={() => setExpr(v)}>{label}</button>)}
        </div>
        {result.error
          ? <p className="form-hint form-hint-error">{result.error}</p>
          : (
            <>
              <p className="tool-result">{result.text}</p>
              <h3 className="form-label">다음 5번의 실행</h3>
              <ol className="tool-list">{result.runs.map(d => <li key={d.getTime()}>{fmt(d)}</li>)}</ol>
            </>
          )}
      </div>
    </div>
  )
}
