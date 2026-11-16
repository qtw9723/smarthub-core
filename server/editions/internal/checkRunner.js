// 챗봇 점검 실행기(사내) — 클러스터 안에서 점검기 CronJob의 템플릿으로 Job을 하나 만든다(kubectl create job --from=cronjob).
// GitHub Actions는 사내망에 닿지 못하므로 점검(Playwright)도 클러스터 안에서 돈다. 설계 4.6.
// 권한: 이 서버의 ServiceAccount는 ns 안에서 그 CronJob 읽기 + Job 생성만(k8s 매니페스트, 4/4).
import { readFileSync } from 'node:fs'
import { request as httpsRequest } from 'node:https'

const SA_DIR = '/var/run/secrets/kubernetes.io/serviceaccount'
const ns = () => process.env.K8S_NAMESPACE || 'sjpark'
const cronJobName = () => process.env.CHECKER_CRONJOB || 'smarthub-chatbot-check'

function readToken() {
  try { return readFileSync(`${SA_DIR}/token`, 'utf8').trim() } catch { return null }
}

function k8sRequest({ method, path, body, token }) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      host: process.env.KUBERNETES_SERVICE_HOST,
      port: process.env.KUBERNETES_SERVICE_PORT || 443,
      method, path,
      ca: readFileSync(`${SA_DIR}/ca.crt`),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolve({ status: res.statusCode, body: data }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

const MANUAL_LABEL = 'smarthub/trigger=manual'
const MAX_RUNNING = 2
const asResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => body })

/** 같은 이름의 env는 덮어쓰고, 값이 없는 입력은 빼서 템플릿 기본값(예: HUB_KEY=*)이 남지 않게 한다. */
function withEnv(env = [], overrides) {
  const keep = env.filter((e) => !(e.name in overrides))
  return [...keep, ...Object.entries(overrides).filter(([, v]) => v).map(([name, value]) => ({ name, value: String(value) }))]
}

export function createK8sRunner({ readToken: rt = readToken, request = k8sRequest, now = Date.now } = {}) {
  return {
    available: () => Boolean(rt()),
    missing: 'k8s 서비스 계정 토큰',
    async dispatch(inputs) {
      const token = rt()
      const base = `/apis/batch/v1/namespaces/${ns()}`
      // 끝나지 않은 수동 점검이 MAX_RUNNING개 이상이면 더 만들지 않는다 — 공개 허브에서 반복 클릭으로 파드가 쌓이지 않게.
      // (수동 Job에는 CronJob의 concurrencyPolicy가 적용되지 않는다)
      const listed = await request({ method: 'GET', path: `${base}/jobs?labelSelector=${encodeURIComponent(MANUAL_LABEL)}`, token })
      if (listed.status === 200) {
        const running = (JSON.parse(listed.body).items ?? []).filter((j) => !j.status?.succeeded && !j.status?.failed).length
        if (running >= MAX_RUNNING) return asResponse(429, `점검이 이미 ${running}건 돌고 있습니다`)
      }
      const got = await request({ method: 'GET', path: `${base}/cronjobs/${cronJobName()}`, token })
      if (got.status !== 200) return asResponse(got.status, got.body)
      const template = JSON.parse(got.body).spec.jobTemplate
      const spec = structuredClone(template.spec)
      const overrides = { HUB_KEY: inputs.hub, BOT_ID: inputs.bot_id, CATEGORY: inputs.category }
      spec.template.spec.containers = spec.template.spec.containers.map((c) => ({ ...c, env: withEnv(c.env, overrides) }))
      const job = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: `smarthub-check-${now()}`, labels: { ...(template.metadata?.labels ?? {}), 'smarthub/trigger': 'manual' } },
        spec,
      }
      const made = await request({ method: 'POST', path: `${base}/jobs`, body: JSON.stringify(job), token })
      return asResponse(made.status, made.body)
    },
  }
}

const runner = createK8sRunner()
export const available = runner.available
export const missing = runner.missing
export const dispatch = runner.dispatch
