// 본문 형식(text/html) 분기 계약. nodemailer에 실제로 어떤 필드가 넘어가는지를 본다.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSendMail = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}))
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }))

import { sendMail, htmlToPlainText } from './smtp.js'

const base = { senderEmail: 'a@b.com', senderPassword: 'pw', to: 'x@y.com', subject: '제목' }
const sentPayload = () => mockSendMail.mock.calls[0][0]

describe('sendMail 본문 형식', () => {
  beforeEach(() => mockSendMail.mockClear())

  it('bodyFormat 미지정이면 텍스트로 보낸다(기존 잡 하위호환)', async () => {
    await sendMail({ ...base, body: '안녕하세요' })
    expect(sentPayload().text).toBe('안녕하세요')
    expect(sentPayload().html).toBeUndefined()
  })

  it("bodyFormat 'text'는 태그를 그대로 텍스트로 보낸다", async () => {
    await sendMail({ ...base, body: '<b>굵게</b>', bodyFormat: 'text' })
    expect(sentPayload().text).toBe('<b>굵게</b>')
    expect(sentPayload().html).toBeUndefined()
  })

  it("bodyFormat 'html'은 html과 텍스트 대체본을 함께 보낸다", async () => {
    await sendMail({ ...base, body: '<p>안녕<br>하세요</p>', bodyFormat: 'html' })
    const sent = sentPayload()
    expect(sent.html).toBe('<p>안녕<br>하세요</p>')
    expect(sent.text).toBe('안녕\n하세요')
  })
})

describe('htmlToPlainText', () => {
  it('태그를 제거하고 블록 경계를 줄바꿈으로 바꾼다', () => {
    expect(htmlToPlainText('<div>첫줄</div><div>둘째줄</div>')).toBe('첫줄\n둘째줄')
  })

  it('보이지 않는 script·style 내용은 통째로 버린다', () => {
    expect(htmlToPlainText('<style>p{color:red}</style><p>본문</p><script>alert(1)</script>')).toBe('본문')
  })

  it('엔티티를 해제하되 &amp;를 이중 해제하지 않는다', () => {
    expect(htmlToPlainText('<p>A &amp;lt; B</p>')).toBe('A &lt; B')
    expect(htmlToPlainText('<p>&lt;태그&gt;&nbsp;유지</p>')).toBe('<태그> 유지')
  })
})
