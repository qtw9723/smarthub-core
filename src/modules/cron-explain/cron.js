// cron-explain — 5필드 cron 표현식 해석과 다음 실행 시각 계산(브라우저 안에서만).
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]] // 요일은 0·7 모두 일요일
const NAMES = ['분', '시', '일', '월', '요일']
const DOW = ['일', '월', '화', '수', '목', '금', '토']

function parseField(src, [min, max], isDow) {
  const out = new Set()
  for (const part of src.split(',')) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step < 1) throw new Error(`잘못된 간격: ${part}`)
    let lo, hi
    if (rangePart === '*') { lo = min; hi = max }
    else if (/^\d+$/.test(rangePart)) { lo = Number(rangePart); hi = stepPart === undefined ? lo : max }
    else if (/^\d+-\d+$/.test(rangePart)) [lo, hi] = rangePart.split('-').map(Number)
    else throw new Error(`해석할 수 없는 값: ${part}`)
    if (lo < min || hi > max || lo > hi) throw new Error(`범위를 벗어났습니다: ${part}`)
    for (let v = lo; v <= hi; v += step) out.add(isDow ? v % 7 : v)
  }
  return out
}

/** 예) 분 시 일 월 요일 → { sets: [분,시,일,월,요일 Set], any: [boolean×5] } */
export function parseCron(expr) {
  const parts = String(expr ?? '').trim().split(/\s+/)
  if (parts.length !== 5) throw new Error('필드는 5개(분 시 일 월 요일)여야 합니다')
  const sets = parts.map((p, i) => parseField(p, RANGES[i], i === 4))
  return { sets, any: parts.map(p => p === '*'), parts }
}

const list = (s) => [...s].sort((a, b) => a - b)

/** 사람이 읽는 한국어 설명. */
export function explainCron(expr) {
  const { sets, any, parts } = parseCron(expr)
  const [min, hour, dom, mon, dow] = sets
  const bits = []
  if (parts[0].startsWith('*/') && any[1]) bits.push(`${parts[0].slice(2)}분마다`)
  else {
    const hh = any[1] ? '매시' : `${list(hour).join(', ')}시`
    const mm = any[0] ? '매분' : `${list(min).join(', ')}분`
    bits.push(`${hh} ${mm}`)
  }
  if (!any[3]) bits.unshift(`${list(mon).join(', ')}월`)
  if (!any[2]) bits.unshift(`${list(dom).join(', ')}일`)
  if (!any[4]) bits.unshift(`${list(dow).map(d => DOW[d]).join('·')}요일`)
  const text = bits.join(' ')
  return text.endsWith('마다') ? `${text} 실행` : `${text}에 실행`
}

/** from 이후 다음 n번의 실행 시각(로컬 시간). 일·요일이 모두 지정되면 둘 중 하나만 맞아도 실행(표준 cron 규칙). */
export function nextRuns(expr, from = new Date(), n = 5) {
  const { sets, any } = parseCron(expr)
  const [min, hour, dom, mon, dow] = sets
  const out = []
  const t = new Date(from)
  t.setSeconds(0, 0)
  t.setMinutes(t.getMinutes() + 1)
  const limit = 60 * 24 * 366 * 2 // 2년치 분
  for (let i = 0; i < limit && out.length < n; i++, t.setMinutes(t.getMinutes() + 1)) {
    if (!mon.has(t.getMonth() + 1) || !hour.has(t.getHours()) || !min.has(t.getMinutes())) continue
    const domOk = dom.has(t.getDate()), dowOk = dow.has(t.getDay())
    const dayOk = !any[2] && !any[4] ? (domOk || dowOk) : (domOk && dowOk)
    if (dayOk) out.push(new Date(t))
  }
  return out
}

export const FIELD_NAMES = NAMES
