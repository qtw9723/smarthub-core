// csv-json — CSV ↔ JSON 변환(브라우저 안에서만 처리, 서버 무접촉).

/** RFC4180 규칙의 CSV 파서: 따옴표 안의 쉼표·줄바꿈·"" 이스케이프를 처리한다. */
export function parseCsv(text, delimiter = ',') {
  const rows = []
  let row = [], field = '', inQuotes = false
  let src = String(text ?? '')
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1) // BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === delimiter) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => !(r.length === 1 && r[0] === ''))
}

/** 첫 줄을 헤더로 보고 객체 배열로. 중복·빈 헤더는 col2 / name_2 처럼 고유하게 만든다. */
export function csvToJson(text, { delimiter = ',', header = true } = {}) {
  const rows = parseCsv(text, delimiter)
  if (!rows.length) return []
  if (!header) return rows
  const seen = new Map()
  const keys = rows[0].map((h, i) => {
    const base = String(h).trim() || `col${i + 1}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n === 1 ? base : `${base}_${n}`
  })
  return rows.slice(1).map(r => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])))
}

const needsQuote = (s, d) => s.includes(d) || /["\r\n]/.test(s) || /^\s|\s$/.test(s)

/** 객체 배열(또는 2차원 배열)을 CSV로. 열은 등장 순서의 합집합. */
export function jsonToCsv(data, { delimiter = ',' } = {}) {
  if (!Array.isArray(data)) throw new Error('JSON 최상위가 배열이어야 합니다')
  const cell = (v) => {
    if (v == null) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return needsQuote(s, delimiter) ? `"${s.replace(/"/g, '""')}"` : s
  }
  if (data.length && Array.isArray(data[0])) return data.map(r => r.map(cell).join(delimiter)).join('\n')
  const cols = []
  for (const o of data) for (const k of Object.keys(o ?? {})) if (!cols.includes(k)) cols.push(k)
  return [cols.map(cell).join(delimiter), ...data.map(o => cols.map(k => cell(o?.[k])).join(delimiter))].join('\n')
}
