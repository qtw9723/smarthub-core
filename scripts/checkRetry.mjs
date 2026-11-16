// 챗봇 체크의 재시도 정책 (순수 로직 — Playwright·DB 무의존).
//
// ⚠ 2026-10-14부터 정기 점검은 재시도하지 않는다(CHECK_ATTEMPTS=1). 아래는 도입 당시의 가설이고,
//   실측(0/59 구제)으로 기각됐다. 기록으로 남긴다.
//
// 왜 필요한가: 실측상 실패의 대부분이 `goto_failed: Timeout 30000ms`이고 특정 봇이 아니라
// 여러 봇에 고루 걸린다. 상대 사이트가 잠깐 느린 것이지 시나리오가 깨진 게 아니다.
// 시도가 1회뿐이면 그때마다 실패 메일이 나가고, 그 잡음이 쌓이면 사람이 알림을 무시한다
// (실제로 "특정 봇는 원래 실패하는 봇"이라는 오해가 그렇게 굳었다).
//
// 실패 종류를 나눠 일부만 재시도하지 않는다 — 무엇이 일시적인지 미리 분류하는 것 자체가
// 추측이고, 비용은 **실패한 봇에만** 붙는다(정상 봇은 1회로 끝난다).

const sleepReal = (ms) => new Promise(r => setTimeout(r, ms))

// 재시도 간격. 처음엔 3초로 뒀다가 실측에서 뒤집혔다(2026-09-07 단건 실행):
// 3초 간격 두 번이 **같은 이유로** 실패했다 — 실패가 무작위가 아니라 "지금 이 사이트가
// 느린 구간"이라 3초로는 상관관계가 끊기지 않는다. 재시도는 앞 시도와 독립이어야 의미가
// 있으므로 간격을 그 구간보다 길게 잡는다. 비용은 실패한 봇에만 붙는다.
const DEFAULT_DELAY_MS = 30_000

// 정기 점검이 실제로 쓰는 시도 횟수. **1 = 즉시 재시도 끔** (ROADMAP v0.10.0 항목7, 2026-10-14).
// 09/17~10/13 실패 59건(접속 19·클릭 15·키워드 25)이 **유형 불문 30초 뒤 재시도로 0건** 살아났다.
// 실패는 "그날 그 사이트 상태"라 같은 날 수십 초 뒤엔 넘을 수 없고, 실패 봇의 점검 시간만 2배였다.
// runWithRetry·attempts 기록은 남긴다 — 재도입하면 다시 셀 수 있게.
export const CHECK_ATTEMPTS = 1

/**
 * 성공할 때까지(또는 attempts를 소진할 때까지) 체크를 다시 시도한다.
 *
 * @param {() => Promise<{ok: boolean, detail: string|null, duration_ms: number}>} attempt
 *   한 번의 체크. 매번 새로 호출되므로 호출자가 페이지를 새로 열어야 한다.
 * @param {{attempts?: number, delayMs?: number, sleep?: (ms:number)=>Promise<void>,
 *          onRetry?: (attemptNo: number, detail: string|null) => void}} [opts]
 * @returns 결과에 `attempts`(실제 시도 횟수)를 더해 돌려준다. 전부 실패하면 detail에도 밝힌다.
 */
export async function runWithRetry(attempt, { attempts = 2, delayMs = DEFAULT_DELAY_MS, sleep = sleepReal, onRetry } = {}) {
  let last
  let used = 0
  for (let n = 1; n <= attempts; n++) {
    used = n
    last = await attempt()
    // 성공한 결과의 detail은 손대지 않는다 — 재시도로 살아났다는 사실을 detail에 섞으면
    // "ok인데 detail이 있는" 상태가 생겨 UI·알림이 실패로 오해할 수 있다.
    // 대신 **별도 필드 attempts**로 싣는다. 그래야 "재시도가 몇 건을 살렸나"를 나중에 셀 수 있다
    // (예전에는 재시도 성공이 첫 시도 성공과 같은 모양이라 효과를 측정할 수 없었다).
    if (last.ok) return { ...last, attempts: used }
    if (n < attempts) {
      onRetry?.(n, last.detail)
      await sleep(delayMs) // 곧바로 다시 때리면 같은 이유로 또 실패한다
    }
  }
  // 읽는 사람이 "한 번 걸린 것"과 "계속 걸리는 것"을 구분할 수 있어야 한다.
  return attempts > 1
    ? { ...last, attempts: used, detail: `[${attempts}회 시도 모두 실패] ${last.detail ?? ''}`.trim() }
    : { ...last, attempts: used }
}
