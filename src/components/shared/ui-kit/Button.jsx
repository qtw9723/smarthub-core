// 팔레트만 SmartHub 테마 토큰(src/index.css의 @theme)으로 바꿨다. 원본은 밝은 테마 +
// primary(#0052CC) 기준이지만 SmartHub는 어두운 배경 + accent(#9d8ffc)를 쓴다.
// primary 버튼의 글자색이 text-bg-base인 이유: accent는 밝은 보라라서 흰 글자면 대비가
// 부족하다 — .gate-btn/.modal-submit도 같은 이유로 color: var(--color-bg-base)를 쓴다.
export default function Button({
  children,
  variant = 'primary',
  disabled = false,
  loading = false,
  type = 'button',
  onClick,
  className = '',
  ...props
}) {
  const base =
    'inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'

  const variants = {
    primary:
      'bg-accent text-bg-base hover:bg-accent-hover',
    secondary:
      'bg-bg-hover text-text-secondary border border-border-subtle hover:text-text-primary hover:border-border-strong',
    ghost:
      'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
    danger:
      'bg-status-error text-bg-base hover:bg-status-error/85',
  }

  const isDisabled = disabled || loading

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={`${base} ${variants[variant] ?? variants.primary} ${isDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''} ${className}`}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  )
}
