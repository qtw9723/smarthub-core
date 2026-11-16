// csv-json 모듈 — CSV ↔ JSON 변환. 전부 브라우저 안에서 처리한다(서버·저장 없음).
import { useMemo, useState } from 'react'
import AppHeader from '../../components/shared/AppHeader.jsx'
import { csvToJson, jsonToCsv } from './convert.js'

const SAMPLE = 'name,team,note\n김민수,배달,"쉼표, 포함"\n이서연,지원,'

export default function HubPanel() {
  const [mode, setMode] = useState('csv2json')
  const [src, setSrc] = useState(SAMPLE)
  const [delimiter, setDelimiter] = useState(',')

  const { out, error } = useMemo(() => {
    try {
      if (mode === 'csv2json') return { out: JSON.stringify(csvToJson(src, { delimiter }), null, 2), error: '' }
      return { out: jsonToCsv(JSON.parse(src || '[]'), { delimiter }), error: '' }
    } catch (e) {
      return { out: '', error: e.message }
    }
  }, [mode, src, delimiter])

  const flip = () => {
    if (!out) return
    setSrc(out)
    setMode(mode === 'csv2json' ? 'json2csv' : 'csv2json')
  }

  return (
    <div className="app">
      <AppHeader toolName="CSV ↔ JSON 변환" />
      <div className="panel-wrap tool-body">
        <div className="tool-bar">
          <button className={`btn${mode === 'csv2json' ? ' active' : ''}`} onClick={() => setMode('csv2json')}>CSV → JSON</button>
          <button className={`btn${mode === 'json2csv' ? ' active' : ''}`} onClick={() => setMode('json2csv')}>JSON → CSV</button>
          <select className="form-select tool-select" value={delimiter} onChange={e => setDelimiter(e.target.value)} aria-label="구분자">
            <option value=",">쉼표(,)</option>
            <option value={'\t'}>탭</option>
            <option value=";">세미콜론(;)</option>
          </select>
          <button className="btn" onClick={flip} disabled={!out}>결과를 입력으로</button>
        </div>
        <div className="tool-cols">
          <label className="form-field">
            <span className="form-label">{mode === 'csv2json' ? 'CSV 입력' : 'JSON 입력(배열)'}</span>
            <textarea className="form-textarea tool-area" value={src} onChange={e => setSrc(e.target.value)} spellCheck={false} />
          </label>
          <label className="form-field">
            <span className="form-label">{mode === 'csv2json' ? 'JSON 결과' : 'CSV 결과'}</span>
            <textarea className="form-textarea tool-area" value={out} readOnly spellCheck={false} />
          </label>
        </div>
        {error && <p className="form-hint form-hint-error">{error}</p>}
      </div>
    </div>
  )
}
