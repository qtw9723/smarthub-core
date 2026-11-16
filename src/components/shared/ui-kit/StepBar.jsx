// 팔레트는 SmartHub 테마 토큰. 현재 단계는 accent, 지난 단계는 취소선 + faint.
export default function StepBar({ steps, currentIndex }) {
  return (
    <div className="flex items-center gap-2 mb-6 text-sm">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          {i > 0 && <span className="text-text-faint">›</span>}
          <span
            className={
              i === currentIndex
                ? 'text-accent font-semibold'
                : i < currentIndex
                  ? 'text-text-faint line-through'
                  : 'text-text-faint'
            }
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  )
}
