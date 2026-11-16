// 팔레트는 SmartHub 테마 토큰 — .checkbox-label과 같은 규칙(accent-color: accent).
export default function Checkbox({ label, className = '', ...props }) {
  return (
    <label className={`inline-flex items-center gap-2 cursor-pointer ${className}`}>
      <input
        type="checkbox"
        className="h-4 w-4 cursor-pointer rounded border-border-strong accent-accent disabled:cursor-not-allowed"
        {...props}
      />
      {label && <span className="text-sm text-text-secondary">{label}</span>}
    </label>
  )
}
