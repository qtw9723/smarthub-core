import { useEffect, useRef } from 'react'

// 공용 모달 셸: 오버레이 + dialog 시맨틱 + ESC/오버레이 클릭 닫기.
// dirty-check가 필요한 모달은 onClose에서 자체 확인 후 닫는다.
export default function Modal({ title, onClose, children, maxWidth = 500 }) {
  const ref = useRef(null)

  // onClose는 소비처에서 인라인 화살표로 넘어와 렌더마다 참조가 바뀐다. 이 값을 아래
  // effect의 의존성으로 쓰면 모달 안에서 한 글자 칠 때마다 effect가 재실행되며
  // focus()가 입력 필드의 포커스를 빼앗는다(한글 IME는 조합 중이던 글자까지 날아간다).
  // 최신 참조는 ref로 따로 흘리고, 등록/포커스 effect는 마운트 시 1회만 돈다.
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current() }
    document.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} style={{ maxWidth }}>
        {title && <h2 className="modal-title">{title}</h2>}
        {children}
      </div>
    </div>
  )
}
