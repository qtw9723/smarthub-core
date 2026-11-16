// text-diff 모듈 — 두 텍스트를 줄 단위로 비교한다(브라우저 안에서만).
import { useMemo, useState } from 'react'
import AppHeader from '../../components/shared/AppHeader.jsx'
import { diffLines, diffStats } from './diff.js'

export default function HubPanel() {
  const [a, setA] = useState('안녕하세요\n주문 안내입니다\n운영 시간: 평일 9-18시')
  const [b, setB] = useState('안녕하세요\n주문 및 배송 안내입니다\n운영 시간: 평일 9-18시\n문의: 채팅 상담')
  const d = useMemo(() => diffLines(a, b), [a, b])
  const { added, removed } = diffStats(d)

  return (
    <div className="app">
      <AppHeader toolName="텍스트 비교" />
      <div className="panel-wrap tool-body">
        <div className="tool-cols">
          <label className="form-field">
            <span className="form-label">이전</span>
            <textarea className="form-textarea tool-area" value={a} onChange={e => setA(e.target.value)} spellCheck={false} />
          </label>
          <label className="form-field">
            <span className="form-label">이후</span>
            <textarea className="form-textarea tool-area" value={b} onChange={e => setB(e.target.value)} spellCheck={false} />
          </label>
        </div>
        <p className="form-hint">추가 {added}줄 · 삭제 {removed}줄</p>
        <pre className="tool-diff">
          {d.map((x, i) => (
            <div key={i} className={`diff-${x.type}`}>{x.type === 'add' ? '+ ' : x.type === 'del' ? '- ' : '  '}{x.text}</div>
          ))}
        </pre>
      </div>
    </div>
  )
}
