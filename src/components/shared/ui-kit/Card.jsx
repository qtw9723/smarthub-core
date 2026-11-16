// 팔레트는 SmartHub 테마 토큰. bg-surface + border-subtle + rounded-xl 조합은
// .job-row/.sender-card/.hub-card 등 SmartHub의 카드 표면 규칙과 같다.
export function Card({ children, className = '' }) {
  return (
    <div className={`bg-bg-surface rounded-xl border border-border-subtle ${className}`}>
      {children}
    </div>
  )
}

export function Panel({ children, className = '' }) {
  return (
    <div className={`bg-bg-surface rounded-xl border border-border-subtle p-6 ${className}`}>
      {children}
    </div>
  )
}

export default Card
