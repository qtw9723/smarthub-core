// 팔레트는 SmartHub 테마 토큰 — .form-input과 같은 규칙(bg-base 안쪽 면 + border-strong,
// 포커스 시 테두리만 accent로).
export default function Input({ className = '', ...props }) {
  return (
    <input
      className={`w-full rounded-lg border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  )
}
