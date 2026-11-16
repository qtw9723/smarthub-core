// KST = UTC+9, DST 없음. UTC Date에 9시간 더해 KST 시계값을 구한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

function toKst(date) {
  return new Date(date.getTime() + KST_OFFSET_MS)
}

export function kstHour(date) {
  return toKst(date).getUTCHours()
}

export function kstDateString(date) {
  return toKst(date).toISOString().slice(0, 10)
}

export function shouldSend(settings, now) {
  if (!settings.enabled) return { send: false, reason: 'disabled' }
  if (kstHour(now) < settings.send_hour) return { send: false, reason: 'not-time' }
  if (settings.last_sent_date === kstDateString(now)) return { send: false, reason: 'already-sent' }
  // 발송 시각 정각만 보던 시절, 07시 tick이 함수 한도(60초)에 잘려 선점 기록 전에 죽자
  // 08시부터는 'not-time'이라 그날 메일이 통째로 사라졌다(10/26). 오늘 아직 못 보냈으면
  // 발송 시각 이후 첫 tick이 따라잡는다. 늦게 온 메일이 안 온 메일보다 낫다.
  if (kstHour(now) > settings.send_hour) return { send: true, reason: 'late' }
  return { send: true, reason: 'ok' }
}

// AI 분석 실행 여부. 발송과 분리 — 발송 시각 이후라면 오늘 분석이 성공할 때까지 매 tick 재시도.
// (발송은 하루 한 번이지만 분석은 일시 장애 시 같은 날 재시도되어야 하므로 정각 고정이 아닌 '이후' 조건)
export function shouldAnalyze(settings, now) {
  if (!settings.enabled) return { run: false, reason: 'disabled' }
  // 할당량이 고갈되면 서버가 "언제 다시 오라"를 알려준다. 그때까지는 부르지 않는다 —
  // 매시 재시도가 성공하지 못한 채 남은 할당량만 깎아 다음 날까지 고갈시켰다.
  // 시각이 지나면 저절로 재개되므로 따로 해제할 상태가 없다.
  if (settings.analysis_blocked_until && new Date(settings.analysis_blocked_until) > now) {
    return { run: false, reason: 'quota-blocked' }
  }
  if (kstHour(now) < settings.send_hour) return { run: false, reason: 'before-hour' }
  if (settings.last_analysis_date === kstDateString(now)) return { run: false, reason: 'already-analyzed' }
  return { run: true, reason: 'ok' }
}
