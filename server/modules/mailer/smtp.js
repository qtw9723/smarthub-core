// server/smtp.js
import nodemailer from 'nodemailer'
import { attachments } from '../../editions/attachments.js'

// 첨부 바이트는 에디션 드라이버에서(외부 Supabase Storage · 사내 디스크).
const fetchAttachment = (path) => attachments.download(path)

// HTML 본문의 텍스트 대체본. 정확한 렌더 재현이 아니라 "읽을 수 있는 대체본"이 목적이다.
// HTML만 보내면 스팸 점수가 오르고 텍스트 전용 클라이언트에서 빈 메일로 보인다.
export function htmlToPlainText(html) {
  return String(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '') // 보이지 않는 내용은 통째로 제거
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&') // &amp;는 마지막에 — 먼저 풀면 다른 엔티티를 이중 해제한다
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function sendMail({ sender, senderEmail, senderPassword, to, subject, body, bodyFormat = 'text', attachments = [] }) {
  const isGmail = senderEmail ? true : sender === 'gmail'
  const user = senderEmail ?? (isGmail ? process.env.GMAIL_USER : process.env.MS_USER)
  const password = senderPassword ?? (isGmail ? process.env.GMAIL_APP_PASSWORD : process.env.MS_APP_PASSWORD)

  const transporter = nodemailer.createTransport({
    host: isGmail ? 'smtp.gmail.com' : 'smtp-mail.outlook.com',
    port: isGmail ? 465 : 587,
    secure: isGmail,
    auth: { user, pass: password },
  })

  const attachmentList = await Promise.all(
    attachments.map(async (a) => {
      const { content, contentType } = await fetchAttachment(a.path)
      return { filename: a.name, content, contentType }
    })
  )

  // html이면 텍스트 대체본을 함께 실어 멀티파트로 보낸다. 그 외(미지정 포함)는 기존 그대로.
  const content = bodyFormat === 'html'
    ? { html: body, text: htmlToPlainText(body) }
    : { text: body }

  await transporter.sendMail({
    from: user,
    to,
    subject,
    ...content,
    ...(attachmentList.length > 0 ? { attachments: attachmentList } : {}),
  })
}
