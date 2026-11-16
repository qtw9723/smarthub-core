import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import { LayoutGrid, Home, LogOut } from 'lucide-react'
import { clearCookie, getCookie } from '../../lib/auth.js'
import { teamHub } from '../../lib/teamHub.js'

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const run = (fn) => { setOpen(false); fn() }

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="명령 팔레트" className="cmdk">
      <Command.Input placeholder="명령 검색…" />
      <Command.List>
        <Command.Empty>결과 없음</Command.Empty>
        {/* 팀 주소에서는 허브 목록·백오피스로 가는 길을 두지 않는다(App.jsx TeamRoutes). */}
        {!teamHub() && (
          <Command.Group heading="이동">
            <Command.Item onSelect={() => run(() => navigate('/'))}><Home size={14} /> 허브 목록</Command.Item>
            <Command.Item onSelect={() => run(() => navigate('/admin'))}><LayoutGrid size={14} /> 백오피스로 이동</Command.Item>
          </Command.Group>
        )}
        {/* 허브는 로그인 없이 들어올 수 있다 — 세션이 없으면 계정 그룹 자체를 숨긴다.
            위 "이동" 항목은 그대로 둔다: 게이트가 걸린 `/`·`/admin`로 가면 로그인 화면이
            뜨므로, 그게 공개 방문자의 로그인 경로가 된다. */}
        {!!getCookie() && (
          <Command.Group heading="계정">
            <Command.Item onSelect={() => run(() => { clearCookie(); navigate('/login') })}><LogOut size={14} /> 로그아웃</Command.Item>
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  )
}
