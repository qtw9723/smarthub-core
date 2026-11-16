// src/demo/mockModules.js — 데모 전용: mailer · grafana-reports · doc-to-api 모듈의 가짜 응답.
// 모든 데이터는 꾸며낸 것이다(수신자·서버·로그 모두 example 도메인/가상 서비스). 상태는 메모리에만 있다.

const MIN = 60 * 1000
const ago = (m) => new Date(Date.now() - m * MIN).toISOString()
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const err = (status, error) => json({ error }, status)
let seq = 500
const uid = (p) => `${p}-${++seq}`

// ── mailer ─────────────────────────────────────────────────────────────
const sends = (pattern, everyMin) => pattern.map((ok, i) => ({ ok, sent_at: ago((pattern.length - i) * everyMin) }))
const mailerSenders = {} // hub_id -> []
const mailerJobs = {}    // hub_id -> []

function seedMailer(hubId) {
  const sender = { id: uid('snd'), email: 'noreply@example.com', created_at: ago(60 * 24 * 20) }
  mailerSenders[hubId] = [sender]
  mailerJobs[hubId] = [
    { id: uid('job'), name: '주간 운영 리포트', sender: sender.email, sender_account_id: sender.id,
      subject: '[운영] 주간 리포트', body: '이번 주 처리 건수와 지연 건을 정리했습니다.', body_format: 'text',
      recipients: ['ops@example.com', 'lead@example.com'], interval_minutes: 60 * 24 * 7, use_index: false,
      send_count: 6, attachments: [], is_active: true, last_sent_at: ago(60 * 20), sort_order: 0,
      recent_sends: sends([true, true, true, true, true, true], 60 * 24 * 7) },
    { id: uid('job'), name: '점검 알림 메일', sender: sender.email, sender_account_id: sender.id,
      subject: '서비스 점검 안내', body: '<p>오늘 02:00~03:00 점검이 예정되어 있습니다.</p>', body_format: 'html',
      recipients: ['team@example.com'], interval_minutes: 360, use_index: true, send_count: 12,
      attachments: [], is_active: true, last_sent_at: ago(95), sort_order: 1,
      recent_sends: sends([true, true, false, true, true, false], 360) },
    { id: uid('job'), name: '월말 정산 안내', sender: sender.email, sender_account_id: sender.id,
      subject: '월말 정산 마감 안내', body: '정산 마감은 말일 18시입니다.', body_format: 'text',
      recipients: ['finance@example.com'], interval_minutes: 60 * 24 * 30, use_index: false,
      send_count: 3, attachments: [], is_active: false, last_sent_at: ago(60 * 24 * 11), sort_order: 2,
      recent_sends: sends([true, true, true], 60 * 24 * 30) },
  ]
}

function handleMailer(sub, method, body, hub) {
  if (!mailerJobs[hub.id]) seedMailer(hub.id)
  const jobs = mailerJobs[hub.id]
  const senders = mailerSenders[hub.id]
  if (sub === '/jobs' && method === 'GET') return json(jobs)
  if (sub === '/jobs' && method === 'POST') {
    const j = { ...body, id: uid('job'), is_active: true, last_sent_at: null, sort_order: jobs.length, recent_sends: [],
      attachments: body.attachments ?? [], body_format: body.body_format ?? 'text' }
    jobs.push(j)
    return json(j, 201)
  }
  const jm = sub.match(/^\/jobs\/([^/]+)$/)
  if (jm) {
    const j = jobs.find((x) => x.id === jm[1])
    if (!j) return err(404, 'not found')
    if (method === 'PATCH') { Object.assign(j, body); return json(j) }
    if (method === 'DELETE') { jobs.splice(jobs.indexOf(j), 1); return json({ success: true }) }
  }
  if (sub === '/senders' && method === 'GET') return json(senders)
  if (sub === '/senders' && method === 'POST') {
    const s = { id: uid('snd'), email: body.email, created_at: new Date().toISOString() }
    senders.push(s)
    return json(s, 201)
  }
  const sm = sub.match(/^\/senders\/([^/]+)$/)
  if (sm && method === 'DELETE') {
    const s = senders.find((x) => x.id === sm[1])
    if (!s) return err(404, 'not found')
    senders.splice(senders.indexOf(s), 1)
    return json({ success: true })
  }
  if (sub.startsWith('/attachments')) return err(400, '데모에서는 첨부 업로드를 지원하지 않습니다')
  return err(404, 'not found')
}

// ── grafana-reports ───────────────────────────────────────────────────
const grafana = {} // hub_id -> { sources: [], types: [] }

function seedGrafana(hubId) {
  const mkQ = (label, query, threshold) => ({ label, query, threshold, enabled: true })
  const base = {
    prom_uid: 'prom-main', es_uid: 'es-main', token: 'glsa_••••••••', recipients: ['ops@example.com'],
    send_hour: 9, enabled: true, log_lag_hours: 3,
    metrics: [mkQ('CPU 사용률(%)', 'avg(rate(node_cpu_seconds_total{mode!="idle"}[5m]))*100', 80),
      mkQ('메모리 사용률(%)', '(1-node_memory_MemAvailable_bytes/node_memory_MemTotal_bytes)*100', 85),
      mkQ('디스크 사용률(%)', '(1-node_filesystem_avail_bytes/node_filesystem_size_bytes)*100', 90)],
    log_queries: [{ label: 'api-server', query: 'app:"api-server" AND level:ERROR', enabled: true },
      { label: 'batch-worker', query: 'app:"batch-worker" AND level:ERROR', enabled: true }],
  }
  const prod = { id: uid('src'), name: '운영', base_url: 'https://grafana.example.com', ...base }
  const stg = { id: uid('src'), name: '스테이징', base_url: 'https://grafana-stg.example.com', ...base, send_hour: 7, enabled: false }
  const entries = [
    { id: uid('e'), run_id: 'run-a', app: 'api-server', occurred_at: ago(95), msg: 'ConnectionTimeout: upstream payment-gateway did not respond within 5000ms' },
    { id: uid('e'), run_id: 'run-a', app: 'api-server', occurred_at: ago(130), msg: 'ConnectionTimeout: upstream payment-gateway did not respond within 5000ms' },
    { id: uid('e'), run_id: 'run-b', app: 'batch-worker', occurred_at: ago(60 * 26), msg: 'RetryExhausted: job settle-daily failed after 3 attempts' },
  ]
  const types = [
    { id: uid('lt'), label: '결제 게이트웨이 타임아웃', description: '외부 결제 연동이 5초 내 응답하지 않음', total_count: 41,
      last_seen_at: ago(95), note: '', ai_note: '결제사 점검 시간대와 겹침', app: 'api-server',
      runs: [{ id: 'run-a', run_at: ago(100), app: 'api-server', count: 2, note: '', logs: [] }], entries: entries.slice(0, 2) },
    { id: uid('lt'), label: '정산 배치 재시도 초과', description: '일 정산 배치가 재시도 한도를 넘김', total_count: 6,
      last_seen_at: ago(60 * 26), note: '데이터팀 확인 요청함', ai_note: '', app: 'batch-worker',
      runs: [{ id: 'run-b', run_at: ago(60 * 26), app: 'batch-worker', count: 1, note: '', logs: [] }], entries: entries.slice(2) },
  ]
  grafana[hubId] = { sources: [prod, stg], types }
}

const summary = [
  '- CPU·메모리·디스크 모두 임계 이내이며 디스크는 62%로 여유가 있습니다.',
  '- api-server에서 결제 게이트웨이 타임아웃이 24시간 동안 2건 발생했습니다(외부 연동 지연으로 추정).',
  '- batch-worker는 이상 없음. 다음 정산 배치 전 재시도 한도 점검을 권장합니다.',
].join('\n')

function reportFor(src) {
  const metrics = [
    { label: 'CPU 사용률(%)', value: 41.3, threshold: 80, over: false },
    { label: '메모리 사용률(%)', value: 72.8, threshold: 85, over: false },
    { label: '디스크 사용률(%)', value: 62.1, threshold: 90, over: false },
  ]
  const logs = [
    { app: 'api-server', count: 2, rows: [
      { time: '14:02:11', msg: 'ConnectionTimeout: upstream payment-gateway did not respond within 5000ms' },
      { time: '12:47:55', msg: 'ConnectionTimeout: upstream payment-gateway did not respond within 5000ms' }] },
    { app: 'batch-worker', count: 0, rows: [] },
  ]
  const alerts = logs.reduce((n, g) => n + (g.count ? 1 : 0), 0)
  return { generatedAt: new Date().toISOString(), source: src.id,
    summary: { status: alerts ? 'warn' : 'ok', alerts }, metrics, logs,
    analysis: { summary, generated_at: ago(60 * 3) } }
}

function handleGrafana(sub, method, body, hub, url) {
  if (!grafana[hub.id]) seedGrafana(hub.id)
  const g = grafana[hub.id]
  const srcId = url.searchParams.get('source')
  const src = g.sources.find((s) => s.id === srcId) ?? g.sources[0]
  const mask = (s) => ({ ...s, token: s.token ? 'glsa_••••••••' : '' })

  if (sub === '/sources' && method === 'GET') return json(g.sources.map(mask))
  if (sub === '/sources' && method === 'POST') {
    const s = { id: uid('src'), name: body.name || '새 환경', base_url: body.base_url ?? '', prom_uid: body.prom_uid ?? '',
      es_uid: body.es_uid ?? '', token: body.token ?? '', recipients: [], send_hour: 9, enabled: false, log_lag_hours: 3,
      metrics: [], log_queries: [] }
    g.sources.push(s)
    return json(mask(s), 201)
  }
  const sm = sub.match(/^\/sources\/([^/]+)$/)
  if (sm) {
    const s = g.sources.find((x) => x.id === sm[1])
    if (!s) return err(404, 'not found')
    if (method === 'PUT') { Object.assign(s, body); return json(mask(s)) }
    if (method === 'DELETE') { g.sources.splice(g.sources.indexOf(s), 1); return json({ success: true }) }
  }
  if (!src) return err(404, 'no source')
  if (sub === '/report') return json(reportFor(src))
  if (sub === '/settings' && method === 'GET') return json(mask(src))
  if (sub === '/settings' && method === 'PUT') {
    const { token, ...rest } = body
    Object.assign(src, rest)
    if (token) src.token = token
    return json(mask(src))
  }
  if (sub === '/analyze') {
    return json({ summary, types: [
      { app: 'api-server', label: '결제 게이트웨이 타임아웃', count: 2, description: '외부 결제 연동이 5초 내 응답하지 않음' }] })
  }
  if (sub === '/test-query') {
    return json(body.type === 'log' ? { ok: true, count: 2, value: 2 } : { ok: true, value: 41.3 })
  }
  if (sub === '/log-types' && method === 'GET') {
    return json(g.types.map((t) => ({ id: t.id, label: t.label, description: t.description, total_count: t.total_count, last_seen_at: t.last_seen_at, note: t.note })))
  }
  const lm = sub.match(/^\/log-types\/([^/]+)$/)
  if (lm) {
    const t = g.types.find((x) => x.id === lm[1])
    if (!t) return err(404, 'not found')
    if (method === 'GET') return json(t)
    if (method === 'PATCH') { Object.assign(t, body); return json(t) }
    if (method === 'DELETE') { g.types.splice(g.types.indexOf(t), 1); return json({ success: true }) }
  }
  const rm = sub.match(/^\/log-type-runs\/([^/]+)$/)
  if (rm && method === 'PATCH') {
    for (const t of g.types) { const r = t.runs.find((x) => x.id === rm[1]); if (r) { Object.assign(r, body); return json(r) } }
    return err(404, 'not found')
  }
  return err(404, 'not found')
}

// ── doc-to-api: 자유형식 문서 → api_def (LLM 대신 고정 샘플) ─────────────────
function handleDocToApi(sub, method) {
  if (sub === '/parse' && method === 'POST') {
    const def = (name, description, method, url, params) => ({
      name, description, method, contentType: method === 'GET' ? 'query' : 'json',
      content: [], headers: [{ key: 'Accept', value: 'application/json' }], params,
      result: { type: 'json', _error: '', _result: '' }, url, authType: 'bearer', authParams: { token: '' },
    })
    return json({ defs: [
      def('getOrder', '주문 상세 조회', 'GET', 'https://api.example.com/v1/orders/{orderId}',
        [{ key: 'orderId', value: '' }]),
      def('createRefund', '환불 요청 생성', 'POST', 'https://api.example.com/v1/refunds',
        [{ key: 'orderId', value: '' }, { key: 'reason', value: '' }]),
    ] })
  }
  return err(404, 'not found')
}

// 반환: Response 또는 null(해당 없음)
export function handleModule(path, method, body, hub, url) {
  const m = path.match(/^\/api\/modules\/(mailer|grafana-reports|doc-to-api)(\/.*)?$/)
  if (!m) return null
  const sub = m[2] || ''
  if (m[1] === 'mailer') return handleMailer(sub, method, body, hub)
  if (m[1] === 'grafana-reports') return handleGrafana(sub, method, body, hub, url)
  return handleDocToApi(sub, method)
}

// 백오피스 활동 피드용 — 발송 기록·AI 분석 이벤트(합성)
export function moduleEvents(hubs, enabledOf) {
  const out = []
  for (const h of hubs) {
    if (enabledOf(h.id, 'mailer') && !mailerJobs[h.id]) seedMailer(h.id)
    if (enabledOf(h.id, 'grafana-reports') && !grafana[h.id]) seedGrafana(h.id)
    if (mailerJobs[h.id]) {
      for (const j of mailerJobs[h.id]) {
        for (const l of j.recent_sends.slice(-2)) {
          out.push({ type: 'mailer', severity: l.ok ? 'good' : 'crit', hubKey: h.key, hubName: h.name,
            title: l.ok ? `${j.name} 발송` : `${j.name} 발송 실패`, detail: l.ok ? null : 'SMTP 응답 지연', at: l.sent_at })
        }
      }
    }
    if (grafana[h.id]) {
      out.push({ type: 'grafana', severity: 'good', hubKey: h.key, hubName: h.name, title: 'Grafana 분석/리포트',
        detail: '이상 1건 — 결제 게이트웨이 타임아웃', at: ago(60 * 3) })
    }
  }
  return out
}
