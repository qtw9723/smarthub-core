// 백오피스 로그인 — 2026-11-10 시도 제한(서버 429)을 "연결 오류"와 구분해 알려 준다.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../lib/api/admin.js', () => ({ getAdminModules: vi.fn() }))
vi.mock('../lib/auth.js', () => ({ getCookie: vi.fn(() => ''), setCookie: vi.fn() }))
import LoginPage from './LoginPage.jsx'
import { getAdminModules } from '../lib/api/admin.js'

const login = (pw) => {
  render(<MemoryRouter><LoginPage /></MemoryRouter>)
  fireEvent.change(screen.getByPlaceholderText(/비밀번호/), { target: { value: pw } })
  fireEvent.submit(screen.getByPlaceholderText(/비밀번호/).closest('form'))
}

describe('LoginPage', () => {
  it('틀리면 "비밀번호가 틀렸습니다."', async () => {
    getAdminModules.mockRejectedValueOnce(new Error('UNAUTHORIZED'))
    login('nope')
    await waitFor(() => expect(screen.getByText('비밀번호가 틀렸습니다.')).toBeInTheDocument())
  })
  it('막히면 몇 분 뒤 다시 하라고', async () => {
    const e = new Error('TOO_MANY_ATTEMPTS'); e.retryAfterMinutes = 15
    getAdminModules.mockRejectedValueOnce(e)
    login('nope')
    await waitFor(() => expect(screen.getByText('시도가 너무 많습니다. 15분 뒤에 다시 시도해 주세요.')).toBeInTheDocument())
  })
})
