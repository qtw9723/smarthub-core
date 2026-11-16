// server/smtp.js
import nodemailer from 'nodemailer'
import { attachments } from './editions/attachments.js'

// 첨부 바이트는 에디션 드라이버에서(외부 Supabase Storage · 사내 디스크).
const fetchAttachment = (path) => attachments.download(path)

export async function sendMail({ sender, senderEmail, senderPassword, to, subject, body, attachments = [] }) {
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

  await transporter.sendMail({
    from: user,
    to,
    subject,
    text: body,
    ...(attachmentList.length > 0 ? { attachments: attachmentList } : {}),
  })
}
