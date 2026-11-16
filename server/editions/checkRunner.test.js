// 챗봇 점검 실행기 — 외부는 GitHub Actions workflow_dispatch(지금 그대로), 사내는 클러스터 안에서 k8s Job 생성.
import { describe, it, expect, vi, afterEach } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules() })

describe('외부(GitHub Actions)', () => {
  it('지금과 같은 요청(URL·헤더·body)', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_test')
    vi.stubEnv('GITHUB_REPO', 'o/r')
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)
    const runner = await import('./external/checkRunner.js')
    await runner.dispatch({ hub: 'cs', bot_id: 'b1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/o/r/actions/workflows/chatbot-check.yml/dispatches')
    expect(init.headers.Authorization).toBe('Bearer ghp_test')
    expect(JSON.parse(init.body)).toEqual({ ref: 'main', inputs: { hub: 'cs', bot_id: 'b1' } })
  })
  it('GITHUB_TOKEN이 없으면 available() false', async () => {
    vi.stubEnv('GITHUB_TOKEN', '')
    expect((await import('./external/checkRunner.js')).available()).toBe(false)
  })
})

describe('사내(k8s Job)', () => {
  const cronJob = {
    spec: { jobTemplate: { metadata: { labels: { app: 'smarthub-check' } }, spec: { backoffLimit: 0, template: { spec: {
      restartPolicy: 'Never',
      containers: [{ name: 'checker', image: 'reg/smarthub-checker:deploy', env: [{ name: 'HUB_KEY', value: '*' }, { name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: 's', key: 'DATABASE_URL' } } }] }],
    } } } } },
  }

  function fakeK8s() {
    const calls = []
    const request = vi.fn(async ({ method, path, body }) => {
      calls.push({ method, path, body })
      if (method === 'GET') return { status: 200, body: JSON.stringify(cronJob) }
      return { status: 201, body: JSON.stringify({ metadata: { name: 'x' } }) }
    })
    return { calls, deps: { readToken: () => 'sa-token', request, now: () => 1700000000000 } }
  }

  it('CronJob 템플릿으로 Job을 만들고 HUB_KEY·BOT_ID·CATEGORY를 덮어쓴다', async () => {
    vi.stubEnv('K8S_NAMESPACE', 'sjpark')
    vi.stubEnv('CHECKER_CRONJOB', 'smarthub-chatbot-check')
    const { createK8sRunner } = await import('./internal/checkRunner.js')
    const { calls, deps } = fakeK8s()
    const res = await createK8sRunner(deps).dispatch({ hub: 'ops', bot_id: 'b1' })
    expect(res.ok).toBe(true)
    // 순서: 돌고 있는 수동 Job 조회 → CronJob 템플릿 조회 → Job 생성
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET', 'POST'])
    expect(calls[1]).toMatchObject({ method: 'GET', path: '/apis/batch/v1/namespaces/sjpark/cronjobs/smarthub-chatbot-check' })
    expect(calls[2]).toMatchObject({ method: 'POST', path: '/apis/batch/v1/namespaces/sjpark/jobs' })
    const job = JSON.parse(calls[2].body)
    expect(job).toMatchObject({ apiVersion: 'batch/v1', kind: 'Job', metadata: { name: 'smarthub-check-1700000000000' } })
    expect(job.spec.backoffLimit).toBe(0)
    const env = job.spec.template.spec.containers[0].env
    expect(env).toContainEqual({ name: 'HUB_KEY', value: 'ops' })
    expect(env).toContainEqual({ name: 'BOT_ID', value: 'b1' })
    expect(env.filter((e) => e.name === 'HUB_KEY')).toHaveLength(1)
    expect(env).toContainEqual({ name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: 's', key: 'DATABASE_URL' } } })
    expect(env.find((e) => e.name === 'CATEGORY')).toBeUndefined()
  })

  it('k8s가 거절하면 ok false와 본문', async () => {
    const { createK8sRunner } = await import('./internal/checkRunner.js')
    const deps = { readToken: () => 't', now: () => 1, request: vi.fn(async ({ method }) => (method === 'GET' ? { status: 403, body: 'forbidden' } : { status: 201, body: '{}' })) }
    const res = await createK8sRunner(deps).dispatch({ hub: 'ops' })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(403)
    expect(await res.text()).toContain('forbidden')
  })

  // 3/4 리뷰 이월(2026-11-10): 공개 허브에서 반복 클릭으로 점검 파드가 쌓이지 않게 — 끝나지 않은 수동 Job이 2개면 429.
  it('끝나지 않은 수동 점검 Job이 2개 이상이면 만들지 않고 429', async () => {
    const { createK8sRunner } = await import('./internal/checkRunner.js')
    const running = { items: [{ status: { active: 1 } }, { status: {} }, { status: { succeeded: 1 } }] }
    const request = vi.fn(async ({ method, path }) => {
      if (method === 'GET' && path.includes('/jobs?')) return { status: 200, body: JSON.stringify(running) }
      if (method === 'GET') return { status: 200, body: JSON.stringify(cronJob) }
      return { status: 201, body: '{}' }
    })
    const res = await createK8sRunner({ readToken: () => 't', now: () => 1, request }).dispatch({ hub: 'ops' })
    expect(res.status).toBe(429)
    expect(request.mock.calls.some(([o]) => o.method === 'POST')).toBe(false)
    const listCall = request.mock.calls.find(([o]) => o.path.includes('/jobs?'))[0]
    expect(listCall.path).toContain('labelSelector=' + encodeURIComponent('smarthub/trigger=manual'))
  })

  it('끝나지 않은 수동 Job이 1개면 만든다', async () => {
    const { createK8sRunner } = await import('./internal/checkRunner.js')
    const request = vi.fn(async ({ method, path }) => {
      if (method === 'GET' && path.includes('/jobs?')) return { status: 200, body: JSON.stringify({ items: [{ status: { active: 1 } }] }) }
      if (method === 'GET') return { status: 200, body: JSON.stringify(cronJob) }
      return { status: 201, body: '{}' }
    })
    expect((await createK8sRunner({ readToken: () => 't', now: () => 1, request }).dispatch({ hub: 'ops' })).ok).toBe(true)
  })

  it('서비스 계정 토큰이 없으면 available() false', async () => {
    const { createK8sRunner } = await import('./internal/checkRunner.js')
    expect(createK8sRunner({ readToken: () => null }).available()).toBe(false)
  })
})

describe('선택', () => {
  it('기본은 외부', async () => {
    vi.stubEnv('SMARTHUB_EDITION', '')
    vi.doMock('./external/checkRunner.js', () => ({ which: 'external' }))
    vi.doMock('./internal/checkRunner.js', () => ({ which: 'internal' }))
    expect((await import('./checkRunner.js')).checkRunner.which).toBe('external')
  })
})
