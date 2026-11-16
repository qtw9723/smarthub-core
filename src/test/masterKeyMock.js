/* global process */
// 테스트 공통: 마스터 키 확인을 예전 동작(서버 설정값 APP_PASSWORD와 비교)으로 둔다.
// 실제 구현은 DB(app_settings)를 먼저 읽는데, 기존 라우트 테스트들은 DB 흉내 호출을 순서대로 준비해 두어서
// 그 조회가 끼면 순서가 어긋난다. 실제 구현은 server/lib/masterKey.test.js가 vi.unmock으로 따로 검증한다.
import { vi } from 'vitest'

vi.mock('../../server/lib/masterKey.js', () => ({
  MASTER_KEY_SETTING: 'master_key_hash',
  MIN_LENGTH: 8,
  MAX_LENGTH: 200,
  isMasterKey: vi.fn(async (candidate) => !!process.env.APP_PASSWORD && candidate === process.env.APP_PASSWORD),
  setMasterKey: vi.fn(async () => {}),
  resetMasterKeyCacheForTest: () => {},
}))
