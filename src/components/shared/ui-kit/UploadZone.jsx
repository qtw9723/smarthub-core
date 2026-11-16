import { useRef, useState } from 'react'

// 공통 파일 업로드 존 — 끌어다 놓기 + 클릭 선택. 문서 입력 화면(스키마·API 등)에서 테마를 통일한다.
// onFile(file): 선택/드롭된 File을 넘긴다. 같은 파일 재선택도 되도록 input value를 매번 비운다.
// 팔레트는 SmartHub 테마 토큰 — .attachment-add와 같은 규칙(점선 테두리 + accent 호버).
export default function UploadZone({
  onFile,
  accept,
  hint,
  title = '파일을 끌어다 놓거나 클릭해서 선택하세요',
  icon = '📄',
  loading = false,
  className = '',
}) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  const pick = (f) => { if (f) onFile(f) }
  const onInputChange = (e) => { pick(e.target.files?.[0]); e.target.value = '' }
  const onDrop = (e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]) }

  return (
    <div
      className={`rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
        dragging
          ? 'border-accent bg-accent/10'
          : 'border-border-strong bg-bg-surface hover:border-accent'
      } ${className}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {loading ? (
        <p className="text-sm text-text-secondary">파일 읽는 중…</p>
      ) : (
        <>
          <div className="mb-3 text-4xl">{icon}</div>
          <p className="mb-1 text-sm font-semibold text-text-primary">{title}</p>
          {hint && <p className="mb-4 text-xs text-text-faint">{hint}</p>}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg-base transition-colors hover:bg-accent-hover"
          >
            파일 선택
          </button>
          <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onInputChange} />
        </>
      )}
    </div>
  )
}
