// 팔레트는 SmartHub 테마 토큰(.form-select와 같은 규칙).
// [color-scheme:dark]: 네이티브 드롭다운 목록(브라우저가 그리는 부분)까지 어둡게 —
// 없으면 어두운 select를 눌렀을 때 흰 팝업이 뜬다.
export default function Select({ children, className = '', ...props }) {
  return (
    <select
      className={`w-full cursor-pointer rounded-lg border border-border-strong bg-bg-base px-3 py-2 text-sm text-text-primary [color-scheme:dark] focus:outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </select>
  )
}
