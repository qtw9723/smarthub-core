// server/modules/doc-to-api/router.js
// 문서 → API 생성 모듈 API. 무상태 — DB 접근 없음.
//
// 자유형식 문서(PDF·엑셀·자유 텍스트)의 API 추출만 서버를 탄다. OpenAPI 3.x는
// 브라우저에서 결정론 파서로 처리하므로 이 라우터를 호출하지 않는다.
//
// LLM은 SmartHub가 직접 호출하지 않는다 — 별도 배포된 문서 파싱 서비스(DOC_PARSE_URL)를
// 프록시한다. gpt-4o 동작을 그대로 보존하고 SmartHub에 LLM 키를 두지 않기 위한 선택이다.
// 설계 근거: docs/superpowers/specs/2026-08-05-smarthub-doc-tools-design.md (D3)
import { Router } from 'express'
import { requireHubAccess } from '../../lib/hubAuth.js'
import { requireHubFeature } from '../../lib/hubFeature.js'
import { limitHubCalls } from '../../lib/hubCallLimit.js'

const router = Router()

// 상류(문서 파싱 서비스 → LLM) 응답 타임아웃. vercel.json의 maxDuration: 60보다 넉넉히
// 짧게 잡아, 상류가 멈춰(콜드스타트·긴 문서) 응답하지 않을 때 **우리가 먼저** 끊고
// 아래 catch의 친절한 502를 내보내도록 한다. 이게 없으면 Vercel이 60초에 함수를
// 강제 종료하고 자체 HTML 에러 페이지를 반환해, 클라이언트(src/lib/api/docToApi.js)가
// JSON 파싱에 실패하며 1분 뒤 원문 텍스트를 그대로 노출한다.
const UPSTREAM_TIMEOUT_MS = 45_000

// 이 경로는 세 관문을 차례로 지난다. 여러 모듈 중 **외부 비용**이 걸린 유일한 경로라
// (상류 파싱 서비스의 LLM 호출이 그쪽 계정에 청구된다) 겹쳐 세운 것이다.
//
//  1. requireHubAccess  — 당신이 이 허브에 들어와도 되는가 (hubs.password_hash)
//  2. requireHubFeature — 그 허브가 이 도구를 켜 두었는가 (hub_features)
//  3. limitHubCalls     — 켠 허브라도 시간당 몇 번까지인가 (hub_module_calls)
//
// 1번만 있던 동안, 비밀번호 없는(=공개) 허브에서는 이 도구를 켠 적이 없어도 무인증 호출이
// 통과했다. 2번이 그 구멍을 막고, 3번은 "정당하게 켠 공개 허브"의 총량 천장을 둔다.
// 기본 허브는 주지 않는다 — hub를 빼는 것만으로 검사를 건너뛸 수 없어야 한다.
router.use(requireHubAccess())
router.use(requireHubFeature('doc-to-api'))

// 시간당 허브별 상한. 운영 중 조정하려고 env로 뺀다(미설정 시 30).
// 함수로 넘겨 요청마다 읽는다 — 모듈 로드 시점에 굳히면 값 변경이 재배포 전까지 먹지 않는다.
const hourlyLimit = () => Number(process.env.DOC_TO_API_HOURLY_LIMIT) || 30

// 형식이 틀린 요청은 상류를 부르지 않으므로 비용도 없다 → 상한보다 **앞**에서 거절해
// 정상 사용자의 몫을 깎지 않는다.
function requireText(req, res, next) {
  const text = req.body?.text
  if (typeof text !== 'string' || text.trim() === '') {
    return res.status(400).json({ error: 'text 필드가 필요합니다 (비어있지 않은 문자열)' })
  }
  return next()
}

router.post('/parse', requireText, limitHubCalls('doc-to-api', { limit: hourlyLimit }), async (req, res) => {
  const text = req.body.text

  const base = process.env.DOC_PARSE_URL
  const anonKey = process.env.DOC_PARSE_KEY
  if (!base || !anonKey) {
    return res.status(500).json({ error: 'DOC_PARSE_URL/DOC_PARSE_KEY 미설정' })
  }

  try {
    const upstream = await fetch(`${base}/api-doc-parse`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 상류 서비스는 키 수준 게이트다.
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })

    if (!upstream.ok) {
      // 상류 본문은 서버 로그로만 남긴다 — 응답에 실어 보내면 다른 서비스의
      // 오류 원문이 클라이언트로 새어나간다. 클라이언트는 .error만 읽는다.
      const detail = await upstream.text().catch(() => '')
      console.error(`[doc-to-api] 상류 ${upstream.status}:`, detail.slice(0, 500))
      return res.status(502).json({
        error: '자유형식 문서 추출에 실패했습니다. OpenAPI 파일은 계속 사용할 수 있습니다.',
        upstreamStatus: upstream.status,
      })
    }

    const data = await upstream.json()
    return res.json({ defs: Array.isArray(data?.defs) ? data.defs : [] })
  } catch (err) {
    // 네트워크 오류 · AbortSignal.timeout의 TimeoutError 모두 여기로 온다.
    // 사유는 서버 로그에만 남기고 응답은 친절한 문구로 통일한다.
    console.error('[doc-to-api] 상류 호출 실패:', err)
    return res.status(502).json({
      error: '자유형식 문서 추출에 실패했습니다. OpenAPI 파일은 계속 사용할 수 있습니다.',
      upstreamStatus: 0,
    })
  }
})

export default router
