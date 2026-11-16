// 테스트 공통: 로그인 시도 제한(server/lib/authThrottle.js)을 "막지 않음·기록만"으로 둔다.
// 실제 구현은 DB를 세므로, DB 흉내 호출을 순서대로 준비해 둔 기존 라우트 테스트의 순서가 어긋난다(masterKeyMock과 같은 이유).
// 실제 구현은 server/lib/authThrottle.test.js가 vi.unmock으로 따로 검증하고, 막힘·기록 연결은 각 라우트 테스트가 이 흉내로 본다.
import { vi } from 'vitest'

vi.mock('../../server/lib/authThrottle.js', () => ({
  MAX_FAILURES: 10,
  WINDOW_MS: 15 * 60 * 1000,
  clientOf: () => 'test-client',
  isBlocked: vi.fn(async () => ({ blocked: false, retryAfterSec: 0 })),
  noteFailure: vi.fn(async () => {}),
  sendBlocked: (res, sec) => res.status(429).json({ error: 'TOO_MANY_ATTEMPTS', retryAfterMinutes: Math.ceil(sec / 60) }),
}))
