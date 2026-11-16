// server/grafana/analyze.js
// 앱별 ERROR 로그를 Gemini로 분석해 (1) 점검 포인트 요약 + (2) 로그 유형 분류 결과를 만든다.
// 격리·테스트 가능: Gemini 호출은 model 주입으로 대체 가능. 파싱/정규화는 순수 함수.
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'

const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'
// 주 모델이 과부하(5xx)로 재시도까지 실패할 때 한 번 더 시도할 모델. 과부하는 모델별로 따로
// 오는 일이 많다(10/15 07시: 2.5-flash만 503). 같은 응답 스키마로 실측 확인(2026-10-15).
// 2.5-flash-lite는 "신규 사용자에게 더 이상 제공되지 않음"(404)이라 쓸 수 없다.
// 주 모델과 같으면 대체하지 않는다.
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.5-flash-lite'
// 프롬프트에 넣고 분류 대상이 되는 앱별 로그 상한. LOG_FETCH(50)와 맞춰 가져온 행 전부를
// 유형에 매핑 가능하게 한다. 이 목록의 #번호가 곧 응답 rows[]의 인덱스.
export const MAX_ROWS_PER_APP = 50

// 앱 → 프롬프트에 노출한(=rows 인덱스 기준이 되는) 행 목록. 프롬프트/적재가 동일하게 사용.
export function appRowIndex(groups) {
  const m = new Map()
  for (const g of groups ?? []) m.set(g.app, (g.rows ?? []).slice(0, MAX_ROWS_PER_APP))
  return m
}

export const RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING, description: '운영자가 점검해야 할 포인트를 한국어 불릿으로 간단히. 이상 없으면 그렇게 적기.' },
    types: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          label: { type: SchemaType.STRING, description: '로그 유형의 짧은 이름' },
          description: { type: SchemaType.STRING, description: '이 유형이 무엇이고 솔루션에서 무엇을 확인해야 하는지' },
          app: { type: SchemaType.STRING, description: '해당 앱 이름' },
          count: { type: SchemaType.INTEGER, description: '이 유형이 대표하는 원시 로그 수' },
          existingMatch: { type: SchemaType.STRING, description: '기존 유형 목록 중 동일하면 그 label, 아니면 빈 문자열' },
          existingMatchId: { type: SchemaType.STRING, description: '기존 유형 목록 중 동일하면 그 유형의 id를 그대로 복사, 아니면 빈 문자열' },
          rows: {
            type: SchemaType.ARRAY,
            description: '이 유형에 속한 원시 로그의 번호(해당 앱 로그 목록의 #번호). 같은 메시지가 3번이면 번호 3개를 모두 나열.',
            items: { type: SchemaType.INTEGER },
          },
          aiNote: {
            type: SchemaType.STRING,
            description: '이 유형에 대한 짧은 관찰 메모(빈도 추세 변화·특이점 등 운영자에게 유용한 것만). 특이사항 없으면 빈 문자열.',
          },
        },
        required: ['label', 'app', 'count'],
      },
    },
  },
  required: ['summary', 'types'],
}

// 분석 대상이 있는 앱만 추림(에러난 그룹·빈 그룹 제외).
export function activeLogGroups(logs) {
  return (logs ?? []).filter((g) => !g.error && (g.count > 0 || (g.rows && g.rows.length)))
}

// 프롬프트 구성. 기존 유형 목록(메모·누적빈도·최근 추세 포함)을 주입해
// 유형명 일관성 유지 + 기지 이슈 구분 + 빈도 급증 감지를 돕는다.
export function buildAnalyzePrompt(groups, existingTypes = []) {
  const typeList = (existingTypes ?? [])
    .map((t) => {
      // id를 함께 내려준다 — 매칭을 라벨 문자열이 아니라 id로 받기 위해서다.
      // 라벨은 운영자가 편집할 수 있어(PATCH /log-types/:id) 매칭 키로 쓰기에 불안정하다.
      let s = `- ${t.id ? `[id: ${t.id}] ` : ''}${t.label}${t.description ? `: ${t.description}` : ''}`
      if (t.note) s += `\n  · 운영자 메모: ${t.note}`
      if (t.ai_note) s += `\n  · AI 메모: ${t.ai_note}`
      const trend = (t.recentRuns ?? [])
        .map((r) => `${String(r.date).slice(5)}:${r.count}`).join(', ')
      if (t.total_count != null || trend) {
        s += `\n  · 누적 ${t.total_count ?? 0}건${trend ? ` · 최근 ${trend}` : ''}`
      }
      return s
    })
    .join('\n') || '(아직 없음)'
  const logBlocks = groups
    .map((g) => {
      const rows = (g.rows ?? []).slice(0, MAX_ROWS_PER_APP)
        .map((r, i) => `  [#${i}] [${r.time}] ${r.msg}`).join('\n')
      return `## 앱: ${g.app} (총 ${g.count}건)\n${rows || '  (로그 없음)'}`
    })
    .join('\n\n')

  return `당신은 운영 모니터링 보조자입니다. 아래는 최근 24시간 앱별 ERROR 로그입니다. 각 로그 앞 [#번호]는 그 앱 안에서의 로그 번호입니다.
반복되는 동일/유사 로그를 하나의 유형으로 묶어 분류하고, 운영자가 솔루션에서 확인해야 할 핵심만 추려 주세요.

[기존 로그 유형] — 가능하면 아래 유형을 재사용. 재사용할 때는 **existingMatchId에 그 유형의 id를 그대로 복사**하고(가장 중요), existingMatch에는 그 label을 기입. 새로운 패턴만 신규 유형으로. 각 유형의 메모·누적/최근 빈도는 과거 회차의 기록입니다:
${typeList}

[로그]
${logBlocks}

요구사항:
- summary: 운영자가 오늘 점검할 포인트를 한국어 불릿 3~6개로 간단히(심각도 높은 것 우선). 각 불릿은 "- "로 시작하고 항목마다 줄바꿈(\\n)으로 구분.
- 메모가 있는 기존 유형은 기지(旣知) 이슈 — summary에서 "기존 이슈"로 구분하고 재설명은 최소화. 신규 유형과 변화에 분석을 집중.
- 최근 추세 대비 빈도가 급증한 유형은 summary에서 강조.
- types: 로그를 유형별로 묶어 각 유형마다 label/description/app/count/rows 작성.
- rows: 그 유형에 속한 로그의 [#번호]를 모두 나열(해당 앱 기준). 같은 메시지가 3번 나오면 번호 3개 모두 포함. 한 번호는 한 유형에만.
- count: 그 유형의 총 발생 추정 건수(앱 총 건수가 표시 행보다 많을 수 있음).
- aiNote: 유형별 짧은 관찰 메모(빈도 추세 변화·특이점 등 다음 운영자에게 유용한 것만). 특이사항 없으면 빈 문자열 — 그러면 기존 AI 메모가 유지됩니다.
- 추측성 과장 금지. 실제 로그에 근거할 것.`
}

// Gemini 응답 텍스트(JSON) → { summary, types[] } 방어적 정규화.
export function parseAnalysis(text) {
  let obj
  try { obj = JSON.parse(text) } catch { return { summary: '', types: [] } }
  const summary = typeof obj?.summary === 'string' ? obj.summary : ''
  const types = Array.isArray(obj?.types)
    ? obj.types.map(normalizeType).filter(Boolean)
    : []
  return { summary, types }
}

// rows[]: 정수 인덱스만 추려 음수 제거·중복 제거. 범위 밖 인덱스는 적재 단계에서 무시.
function normalizeRows(rows) {
  if (!Array.isArray(rows)) return []
  const seen = new Set()
  const out = []
  for (const v of rows) {
    const n = Math.trunc(Number(v))
    if (Number.isInteger(n) && n >= 0 && !seen.has(n)) { seen.add(n); out.push(n) }
  }
  return out
}

function normalizeType(t) {
  if (!t || typeof t !== 'object') return null
  const label = String(t.label ?? '').trim()
  if (!label) return null
  const rows = normalizeRows(t.rows)
  const count = Number.isFinite(t.count) ? Math.max(0, Math.trunc(t.count)) : rows.length
  return {
    label,
    description: String(t.description ?? '').trim(),
    app: String(t.app ?? '').trim(),
    count,
    existingMatch: String(t.existingMatch ?? '').trim(),
    existingMatchId: String(t.existingMatchId ?? '').trim(),
    rows,
    aiNote: String(t.aiNote ?? '').trim(),
  }
}

// Gemini 모델 핸들 생성(키 없으면 throw). 테스트에서는 model 주입으로 대체.
export function getModel(name = MODEL) {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY 미설정')
  const genai = new GoogleGenerativeAI(key)
  return genai.getGenerativeModel({
    model: name,
    generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
  })
}

// 백오프 예산(1+2+4초)보다 넉넉히 큰 값. 서버가 이보다 긴 대기를 지시하면 재시도로는
// 절대 넘길 수 없는 벽이라는 뜻이다.
const MAX_WAITABLE_SECONDS = 60

// 서버가 알려준 재시도 대기 시간(초). Gemini는 RetryInfo.retryDelay에 "69302s" 형태로 싣는다.
export function retryDelaySeconds(e) {
  const m = /retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i.exec(String(e?.message ?? ''))
  return m ? Number(m[1]) : null
}

// Gemini 일시 장애(과부하/속도제한/네트워크)인지 판정. 설정 오류(키 없음)는 재시도 무의미.
//
// ⚠ 429를 무조건 재시도하면 **장애가 커진다.** 무료 등급은 하루 20건인데 호출 1회가
// 최대 4건(1+재시도3)이 되어 실패한 tick 5번이면 하루치가 전부 소진됐다. 게다가 이 재시도는
// 성공할 수 없다 — 서버가 "19시간 뒤에 다시 오라"고 알려주는데 백오프는 몇 초다.
// 그래서 429는 **서버가 지시한 대기 시간을 보고** 판단한다. 대기가 짧거나(분 단위 속도제한)
// 정보가 없으면 예전처럼 재시도하고, 길면 즉시 전파해 호출부가 그날을 포기하게 한다.
// 5xx는 할당량과 무관한 서버 장애이므로 그대로 재시도한다.
export function isRetryableError(e) {
  const msg = String(e?.message ?? '')
  if (/GEMINI_API_KEY/.test(msg)) return false
  const transient = /\b(500|502|503|504)\b/.test(msg) ||
    /overload|high demand|unavailable|temporar|deadline|timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|fetch failed/i.test(msg)
  if (transient) return true
  if (!/\b429\b/.test(msg) && !/rate ?limit/i.test(msg)) return false
  const wait = retryDelaySeconds(e)
  return wait === null || wait <= MAX_WAITABLE_SECONDS
}

// 서버 쪽 과부하·장애(5xx)인지. 할당량(429)·네트워크 오류는 다른 모델로 가도 같은 벽이다.
export function isServerOverload(e) {
  const msg = String(e?.message ?? '')
  if (/\b429\b/.test(msg)) return false
  return /\b(500|502|503|504)\b/.test(msg) || /overload|high demand|unavailable/i.test(msg)
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 일시 오류에 한해 지수 백오프 재시도. 그 외 오류는 즉시 전파.
// sleep 주입으로 테스트에서 실제 대기 없이 검증 가능.
export async function withRetry(fn, { retries = 3, baseDelayMs = 1000, sleep = defaultSleep, isRetryable = isRetryableError } = {}) {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e
      await sleep(baseDelayMs * 2 ** attempt)
      attempt++
    }
  }
}

// 로그 분석 실행. 분석 대상이 없으면 LLM 호출 없이 빈 결과.
// model 주입 시 그것을 사용(테스트/대체). Gemini 일시 장애는 재시도(opts.retry로 조정).
// 재시도까지 실패하면 throw → 호출부에서 best-effort 처리.
export async function analyzeLogs(logs, existingTypes = [], model = null, opts = {}) {
  const groups = activeLogGroups(logs)
  if (!groups.length) return { summary: '', types: [] }
  const m = model ?? getModel()
  const prompt = buildAnalyzePrompt(groups, existingTypes)
  let result
  try {
    result = await withRetry(() => m.generateContent(prompt), opts.retry)
  } catch (e) {
    // 07시 분석이 10/13~10/15 연달아 503 "high demand"로 실패해 메일이 요약 없이 나갔다.
    // 재시도는 이미 했고(1+2+4초) 함수 한도(60초) 안에서 더 길게 기다릴 수는 없다 — 그래서
    // 기다리는 대신 다른 모델로 한 번 더 간다. 429(할당량)는 대체하지 않는다: 차단 시각
    // 기록(router)이 그 오류를 보고 판단해야 한다.
    const fallback = opts.fallbackModel !== undefined ? opts.fallbackModel
      : (!model && FALLBACK_MODEL !== MODEL ? getModel(FALLBACK_MODEL) : null)
    if (!fallback || !isServerOverload(e)) throw e
    console.warn(`[grafana-reports/analyze] 주 모델 과부하, 대체 모델로 재시도: ${String(e?.message ?? e).slice(0, 200)}`)
    result = await withRetry(() => fallback.generateContent(prompt), opts.retry)
  }
  const text = typeof result?.response?.text === 'function' ? result.response.text() : (result?.response?.text ?? '')
  return parseAnalysis(text)
}

// 분석에 시간 상한을 건다. 503 재시도(1+2+4초)에 대체 모델 재시도까지 이어지면 함수 한도
// (60초)를 넘겨 tick이 통째로 잘렸고, 발송도 실패 기록도 못 남겼다(10/26 07시). 상한을 넘기면
// 분석만 포기하고 발송은 계속한다 — 분석은 다음 tick이 다시 한다.
// 진 쪽 promise가 나중에 reject돼도 처리되지 않은 거부로 프로세스를 흔들지 않게 삼킨다.
export function withDeadline(promise, ms) {
  promise.catch(() => {})
  if (ms <= 0) return Promise.reject(new Error('analysis-timeout: 남은 시간 없음'))
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`analysis-timeout: ${ms}ms 안에 끝나지 않음`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// 분석 실패 사유를 DB에 남길 형태로 만든다(ROADMAP v0.10.0 항목8). 크론 응답은 ~1시간이면
// 지워져 사후 원인 조사가 불가능했다. 원문엔 키·토큰이 섞일 수 있으니 가리고, 길이를 묶는다.
const ERROR_STORE_MAX = 2000
export function errorForStorage(e) {
  return String(e?.message ?? e)
    .replace(/([?&]key=)[^&\s"']+/gi, '$1***')
    .replace(/(Bearer\s+)\S+/gi, '$1***')
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, '***')
    .slice(0, ERROR_STORE_MAX)
}
