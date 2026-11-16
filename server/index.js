// server/index.js
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { getModules, getModule } from './modules/index.js'
import adminRouter from './routes/admin.js'
import hubsRouter from './routes/hubs.js'
import { fileURLToPath } from 'node:url'
import { edition } from './edition.js'
import { mountStatic } from './static.js'
import { teamHostGuard } from './lib/teamHost.js'

const app = express()
const PORT = process.env.PORT ?? 3001

app.use(cors({ origin: ['http://localhost:5173'], credentials: true }))
// body-parser 기본 한도는 100kb다 — 문서 전문처럼 큰 본문을 받는 모듈을 위해 1mb로 올린다.
app.use(express.json({ limit: '1mb' }))

// 프로세스 생존 확인(k8s 프로브) — 허브 관문·DB 없이. DB가 잠깐 끊겨도 파드가 재시작을 반복하지 않게 한다.
app.get('/api/health', (_req, res) => res.json({ ok: true }))

// 팀 주소(<허브키>.<TEAM_HOST_SUFFIX>)면 그 허브만 — 백오피스·다른 허브 API를 막는다. 접미사가 없으면 그냥 통과.
app.use(teamHostGuard())

// 모듈 레지스트리 순회 마운트: /api/modules/<key>/*
// 서버 파트가 없는 모듈은 서버 파트가 없어 apiRouter가 없다 — 건너뛴다.
for (const m of getModules()) if (m.apiRouter) app.use(`/api/modules/${m.key}`, m.apiRouter)

// 하위호환 alias: 배포된 pg_cron(jobid 9)·GitHub 워크플로우가 /api/chatbot/dispatch 사용 → 유지
const chatbot = getModule('chatbot-monitoring')
if (chatbot) app.use('/api/chatbot', chatbot.apiRouter)

// 공개(무인증) 허브 조회 — 허브 진입에 비밀번호가 필요 없으므로 어드민 경로와 분리한다.
app.use('/api/hubs', hubsRouter)

app.use('/api/admin', adminRouter)

// 사내 에디션은 한 컨테이너가 화면까지 서빙한다(외부는 Vercel이 dist를 서빙). API 라우트 뒤에 둔다.
if (edition() === 'internal' || process.env.SERVE_STATIC === '1') {
  mountStatic(app, process.env.STATIC_DIR || fileURLToPath(new URL('../dist', import.meta.url)))
}

// Vercel(서버리스)에서는 listen 없이 export.
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`SmartHub server running on :${PORT}`))
}

export default app
