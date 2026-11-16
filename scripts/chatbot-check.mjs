// 챗봇 일일 시나리오 체크 러너 (GitHub Actions에서 실행)
// 필요 환경변수: (외부) SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY · (사내) SMARTHUB_EDITION=internal, DATABASE_URL (선택: HUB_URL·PUBLIC_URL·TEAM_HOST_SUFFIX — 알림 링크, server/lib/hubUrl.js · HUB_KEY, BOT_ID, CATEGORY)
// HUB_KEY(기본 delivery)로 대상 허브를 한정한다.
import { chromium } from 'playwright'
import { repos } from '../server/data/index.js'
import { mkdir } from 'node:fs/promises'
import { judgeStep, buildFailureMail, normalizeStep } from './lib/judge.mjs'
import { sendMail } from '../server/smtp.js'
import { runWithRetry, CHECK_ATTEMPTS } from './checkRetry.mjs'
import { hubPageUrl } from '../server/lib/hubUrl.js'

const HUB_KEY = process.env.HUB_KEY ?? 'delivery'
const STEP_TIMEOUT_MS = 60_000
// 1순위: 챗봇 위젯의 입력창 id. 이후 일반 휴리스틱 순.
const INPUT_SELECTORS = ['#chat-input-text', 'textarea', 'input[type="text"]', 'input:not([type])', '[contenteditable="true"]']


// 채팅 UI가 iframe 안에 있을 수 있으므로 모든 프레임을 순회하며 탐색.
// SPA 렌더링 지연 대비 15초 동안 0.5초 간격 재시도.
async function findInput(page, override) {
  const candidates = override ? [override, ...INPUT_SELECTORS] : INPUT_SELECTORS
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const sel of candidates) {
        const loc = frame.locator(sel).first()
        if (await loc.isVisible().catch(() => false)) return { input: loc, frame }
      }
    }
    await page.waitForTimeout(500)
  }
  return null
}

// 클릭 대상(버튼/링크/퀵리플라이) 탐색 — 모든 프레임 순회, 15초 재시도.
// selector가 있으면 그것을 최우선, 없으면 보이는 텍스트로 탐색.
async function findClickable(page, text, selector) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      const locators = selector
        ? [frame.locator(selector).first()]
        : [
            frame.getByRole('button', { name: text }).first(),
            frame.getByText(text, { exact: true }).first(),
            frame.getByText(text).first(),
          ]
      for (const loc of locators) {
        if (await loc.isVisible().catch(() => false)) return { target: loc, frame }
      }
    }
    await page.waitForTimeout(500)
  }
  return null
}

// 기대 키워드가 어느 프레임에든 노출되는지 폴링(교차 프레임 응답 대응).
// 예: 하나은행은 동의 팝업이 부모 프레임, 챗봇 응답은 채팅 iframe에 나온다.
async function waitForTextAnyFrame(page, expect, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (await frame.getByText(expect).first().isVisible().catch(() => false)) return true
    }
    await page.waitForTimeout(500)
  }
  return false
}

async function checkBot(browser, bot) {
  const started = Date.now()
  const page = await browser.newPage()
  try {
    // domcontentloaded로 대기(networkidle는 챗봇 위젯의 웹소켓·롱폴링·하트비트 때문에
    // 영원히 idle이 안 돼 화면이 정상이어도 timeout 남). 실제 요소 준비는 아래
    // findInput/findClickable의 15초 폴링이 담당한다.
    await page.goto(bot.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      .catch(err => { throw new Error(`goto_failed: ${err.message.slice(0, 120)}`) })

    for (const [i, rawStep] of bot.scenario.entries()) {
      const step = normalizeStep(rawStep)

      if (step.type === 'click') {
        const found = await findClickable(page, step.text, step.selector)
        if (!found) throw new Error(`button_not_found: 스텝 ${i + 1}에서 ${step.selector ? `셀렉터 "${step.selector}"` : `"${step.text}" 버튼`}을 찾지 못함`)
        await found.target.click()
      } else {
        // 스텝별 셀렉터 > 봇 레벨 셀렉터(구버전 호환) > 기본 휴리스틱
        const found = await findInput(page, step.selector ?? bot.input_selector)
        if (!found) throw new Error(`input_not_found: 스텝 ${i + 1}에서 입력창을 찾지 못함`)
        await found.input.fill(step.text)
        await found.input.press('Enter')
      }

      // 응답 검사: 액션 프레임을 포함한 모든 프레임에서 기대 키워드 탐색
      // (동의 팝업=부모 프레임, 응답=채팅 iframe 등 교차 프레임 케이스 대응)
      const appeared = await waitForTextAnyFrame(page, step.expect, STEP_TIMEOUT_MS)
      if (!appeared) {
        // 실패 발췌는 모든 프레임 본문을 합쳐서 수집
        let pageText = ''
        for (const f of page.frames()) pageText += (await f.locator('body').innerText().catch(() => '')) + '\n'
        const verdict = judgeStep(pageText, step.expect)
        throw new Error(`timeout: 스텝 ${i + 1} ${verdict.reason}\n응답 발췌: ${verdict.excerpt ?? '(없음)'}`)
      }
    }
    return { ok: true, detail: null, duration_ms: Date.now() - started }
  } catch (err) {
    // 실패 스크린샷 폴더 — Actions는 ./screenshots(artifact 업로드), 사내 점검기 이미지는 SCREENSHOT_DIR=/tmp/screenshots(비루트·읽기 전용 작업 폴더).
    const shotDir = process.env.SCREENSHOT_DIR || 'screenshots'
    await mkdir(shotDir, { recursive: true })
    await page.screenshot({ path: `${shotDir}/${bot.name.replace(/[^\w가-힣-]/g, '_')}.png`, fullPage: true }).catch(() => {})
    return { ok: false, detail: String(err.message).slice(0, 500), duration_ms: Date.now() - started }
  } finally {
    await page.close()
  }
}

async function notifyFailures(failures, hubId, hubKey) {
  if (!failures.length) return
  // 조회 실패는 수신자 없음과 같게 본다(이전 동작).
  const settings = await repos.chatbots.getSettings(hubId).catch(() => null)
  const recipients = settings?.recipients ?? []
  if (!recipients.length) { console.log('수신자 미설정 — 메일 생략'); return }

  // 발신 계정은 환경변수로 받는다(ALERT_SMTP_USER·ALERT_SMTP_PASSWORD) — 없으면 메일은 생략한다.
  const sender = process.env.ALERT_SMTP_USER && process.env.ALERT_SMTP_PASSWORD
    ? { email: process.env.ALERT_SMTP_USER, app_password: process.env.ALERT_SMTP_PASSWORD } : null
  if (!sender) { console.log('발신 계정 없음 — 메일 생략'); return }

  const { subject, body } = buildFailureMail(failures, hubPageUrl(hubKey, 'chatbot-monitoring') || `http://localhost:5173/hub/${hubKey}/chatbot-monitoring`)
  for (const to of recipients) {
    await sendMail({ senderEmail: sender.email, senderPassword: sender.app_password, to, subject, body })
      .catch(err => console.error(`메일 발송 실패(${to}):`, err.message))
  }
  console.log(`실패 알림 메일 발송: ${recipients.length}명`)
}

// 부분 실행: 단건(BOT_ID) 또는 카테고리(CATEGORY). 둘 다 있으면 BOT_ID 우선.
const isSubset = Boolean(process.env.BOT_ID || process.env.CATEGORY)

// 브라우저는 점검할 봇이 있을 때 한 번만 띄운다(전체 허브 모드에서도 허브마다 다시 띄우지 않게).
let browser = null
const getBrowser = async () => (browser ??= await chromium.launch())

/** 허브 하나 점검. 봇 목록 조회 실패는 throw(호출자가 처리). */
async function runHub(hubId, hubKey) {
  const bots = await repos.chatbots.listEnabledBots(hubId, { botId: process.env.BOT_ID, category: process.env.CATEGORY })
  const targets = bots.filter(b => Array.isArray(b.scenario) && b.scenario.length > 0)
  console.log(`[${hubKey}] 체크 대상: ${targets.length}개 봇`)
  if (!targets.length) return { checked: 0, failed: 0 }

  const b = await getBrowser()
  const failures = []
  for (const bot of targets) {
    // 즉시 재시도는 꺼 두었다(CHECK_ATTEMPTS=1, 근거는 checkRetry.mjs). 실측 0/59 구제.
    const result = await runWithRetry(() => checkBot(b, bot), {
      attempts: CHECK_ATTEMPTS,
      onRetry: (n, detail) => console.log(`[RETRY] ${bot.name} ${n}회차 실패 — 재시도: ${detail}`),
    })
    console.log(`[${result.ok ? 'OK' : 'FAIL'}] ${bot.name} (${result.duration_ms}ms)${result.ok ? '' : ` — ${result.detail}`}`)
    // attempts를 함께 남긴다 — 재시도로 살아난 성공은 detail이 첫 시도 성공과 똑같아서,
    // 이 값이 없으면 "재시도가 몇 건을 살렸나"에 답할 데이터가 남지 않는다.
    await repos.checks.insert({ chatbot_id: bot.id, hub_id: hubId, ok: result.ok, detail: result.detail, duration_ms: result.duration_ms, attempts: result.attempts })
      .catch((logErr) => console.error('로그 기록 실패:', logErr.message))
    if (!result.ok) failures.push({ name: bot.name, detail: result.detail })
  }
  if (isSubset) console.log('부분 실행(단건/카테고리) — 메일 알림 생략')
  else await notifyFailures(failures, hubId, hubKey)
  console.log(`[${hubKey}] 완료: 성공 ${targets.length - failures.length} / 실패 ${failures.length}`)
  return { checked: targets.length, failed: failures.length }
}

if (HUB_KEY === '*') {
  // 사내 정시 점검(k8s CronJob): 챗봇 모니터링이 켜진 모든 허브. 허브마다 격리.
  const { forEachHub } = await import('../server/lib/forEachHub.js')
  const results = await forEachHub('chatbot-monitoring', (h) => runHub(h.id, h.key))
  for (const r of results) if (!r.ok) console.error(`[${r.hub}] 점검 실패:`, r.error)
  // 허브 하나라도 실패하면 CronJob이 실패로 보이게(봇 점검 실패는 알림 메일로 따로 간다 — 이건 실행 자체의 실패).
  if (results.some((r) => !r.ok)) process.exitCode = 1
} else {
  // 대상 허브 해석 (HUB_KEY → hub_id). 없으면 종료.
  let hubId
  try {
    hubId = await repos.hubs.getHubId(HUB_KEY)
  } catch (e) {
    console.error(`허브 조회 실패(key=${HUB_KEY}):`, e.message); process.exit(1)
  }
  if (!hubId) { console.error(`허브 조회 실패(key=${HUB_KEY}):`, 'not found'); process.exit(1) }
  try {
    await runHub(hubId, HUB_KEY)
  } catch (e) {
    console.error('점검 실행 실패:', e.message); await browser?.close(); process.exit(1)
  }
}
await browser?.close()
