// 컬럼 제외·개명을 반영한 투영 (순수 모듈, 파싱 라이브러리·UI 무의존).
// applyFieldSelection({ headers, rows }, fieldSpecs) → { headers, rows, fieldSpecs }
// CSV(excelToUploadCsv)와 스키마(buildSchema)가 같은 투영을 소비해야
// 두 산출물의 컬럼 구성이 어긋나지 않는다.

function outputNameOf(header, spec) {
  const name = spec?.outputName
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : header
}

/**
 * @param {{ headers: string[], rows: Array<Record<string, string>> }} sheet
 * @param {Record<string, { include?: boolean, outputName?: string }>} fieldSpecs
 * @returns {{ headers: string[], rows: Array<Record<string, string>>, fieldSpecs: Record<string, object>, collisions: Array<{header: string, requested: string, applied: string}> }}
 */
export function applyFieldSelection({ headers, rows }, fieldSpecs) {
  const specs = fieldSpecs || {}
  // include 미지정은 포함으로 본다(스펙이 아직 안 만들어진 컬럼도 잃지 않도록).
  const kept = (headers || []).filter((h) => specs[h]?.include !== false)

  // ⚠ 개명 결과가 겹치면 rows(Record) 조립에서 뒤 열이 앞 열을 덮어써 값이 사라진다.
  // UI 검증이 먼저 막지만, 여기서도 접미(_2)로 유일하게 만들어 데이터 소실만은 없게 한다.
  const used = new Set()
  const collisions = []
  const outHeaders = kept.map((h) => {
    const requested = outputNameOf(h, specs[h])
    let applied = requested
    let n = 2
    while (used.has(applied)) applied = `${requested}_${n++}`
    used.add(applied)
    if (applied !== requested) collisions.push({ header: h, requested, applied })
    return applied
  })

  const outRows = (rows || []).map((row) => {
    const next = {}
    kept.forEach((h, i) => { next[outHeaders[i]] = row[h] ?? '' })
    return next
  })

  const outSpecs = {}
  kept.forEach((h, i) => { outSpecs[outHeaders[i]] = specs[h] ?? {} })

  return { headers: outHeaders, rows: outRows, fieldSpecs: outSpecs, collisions }
}
