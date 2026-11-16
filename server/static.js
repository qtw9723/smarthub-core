// 사내 에디션 정적 서빙 — 외부(Vercel)에서는 Vercel이 하던 일을 Express가 한다(vercel.json rewrites와 같은 규칙).
//   정적 파일(dist) · 그 밖의 비-API GET → index.html(SPA)
// API(/api/*)는 SPA로 보내지 않는다 — 없는 API가 HTML 200으로 보이면 클라이언트 오류가 숨는다.
// 팀 주소(req.teamHub, lib/teamHost.js)로 온 화면 요청은 index.html에 팀 허브 표식을 심는다 — 화면이 그 허브에 갇힌다.
import express from 'express'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export function mountStatic(app, dir) {
  // index는 끈다 — `/`도 아래 SPA 처리로 와야 팀 표식을 심을 수 있다.
  app.use(express.static(dir, { index: false }))
  app.get(/^(?!\/api(\/|$)).*/, (req, res) => {
    if (!req.teamHub) return res.sendFile(join(dir, 'index.html'))
    // 허브 키는 [a-z0-9-]만 통과한 값이라 그대로 넣어도 된다.
    const html = readFileSync(join(dir, 'index.html'), 'utf8')
      .replace('<head>', `<head><meta name="smarthub-team-hub" content="${req.teamHub}">`)
    res.type('html').send(html)
  })
}
