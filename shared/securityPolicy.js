// shared/securityPolicy.js — 모듈 보안 레벨의 정의와 모듈별 기본값. 클라이언트(백오피스 판정)와
// 서버(레벨 조정 API 검증)가 함께 import하는 순수 데이터 파일이다 — 의존성을 두지 말 것.
//
// 레벨은 **모듈 단위**로 정한다. 모듈을 쓰는 사람(데이터를 넣는 사람)이 바꾸는 것이 아니라,
// 관리자가 백오피스에서 조정한다(DB hub_module_security). 여기 값은 그 조정이 없을 때의 기본값이고,
// "그 모듈이 담을 수 있는 최악"을 기준으로 매긴다.
//
// 참고한 사례: Kubernetes Pod Security Standards(레벨과 처리 방식 분리, 예외는 따로 기록),
// Android protectionLevel(위험 등급은 플랫폼이 정함), 데이터 분류 4단계("노출되면 어떤 피해").

export const LEVELS = ['L0', 'L1', 'L2', 'L3']

export const LEVEL_INFO = {
  L0: { name: '공개', definition: '노출·오용돼도 피해 없음', requirement: '없음' },
  L1: { name: '내부', definition: '사내 정보가 보이는 정도', requirement: '없음 — 안내만' },
  L2: { name: '민감', definition: '고객 정보가 드러나거나, 비용이 생기거나, 저장된 비밀이 쓰임', requirement: '허브 비밀번호' },
  L3: { name: '제한', definition: '남의 이름으로 외부에 행동함(메일 발송 등)', requirement: '허브 비밀번호' },
}

// 새 모듈을 레지스트리에 넣으면 여기에도 넣는다(빠지면 테스트가 실패한다).
export const MODULE_SECURITY_DEFAULTS = {
  'chatbot-monitoring': { level: 'L2', reason: '챗봇 목록과 점검 이력이 드러납니다' },
  'csv-json': { level: 'L0', reason: '브라우저 안에서만 변환하고 아무것도 저장·전송하지 않습니다' },
  'cron-explain': { level: 'L0', reason: '브라우저 안에서만 계산하고 아무것도 저장·전송하지 않습니다' },
  'text-diff': { level: 'L0', reason: '브라우저 안에서만 비교하고 아무것도 저장·전송하지 않습니다' },
}

// 표에 없는 모듈은 보호 쪽으로 본다 — 빠뜨린 모듈이 조용히 공개 취급되면 안 된다.
export const UNKNOWN_MODULE_LEVEL = 'L2'

/** 'L0'..'L3' → 0..3. 모르는 값은 UNKNOWN_MODULE_LEVEL의 순위. */
export function levelRank(level) {
  const i = LEVELS.indexOf(level)
  return i >= 0 ? i : LEVELS.indexOf(UNKNOWN_MODULE_LEVEL)
}

/** 이 레벨이 허브 비밀번호를 요구하는가(L2부터). */
export function needsPassword(level) {
  return levelRank(level) >= 2
}

export function defaultLevelOf(key) {
  return MODULE_SECURITY_DEFAULTS[key]?.level ?? UNKNOWN_MODULE_LEVEL
}
