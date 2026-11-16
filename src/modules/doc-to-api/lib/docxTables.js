// mammoth가 만든 docx HTML에서 표와 본문 텍스트를 뽑는다 (순수 모듈).
//
// ⚠ DOMParser를 쓰지 않는다 — Deno 테스트에서 DOM 없이 돌아야 한다.
// ⚠ 중첩 표를 올바르게 처리하기 위해 깊이 추적 스캐너를 사용한다.
//    바깥 표만 추출하고, 안쪽 표는 자신을 담는 셀의 텍스트로 평탄화된다.
// ⚠ 산출 형태는 serializeWorkbook의 SheetData와 **정확히 같다**({name, rows}).
//    그래야 docx가 엑셀과 같은 탭 구분 텍스트가 되어 추출 프롬프트를 손대지 않는다.

const TABLE_RE = /<table[^>]*>([\s\S]*?)<\/table>/gi
const ROW_RE = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
const CELL_RE = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi

const ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
}

function decodeEntities(s) {
  return s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] ?? m)
}

/** 태그를 벗기고 공백을 정리한다. */
function plainText(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/**
 * 태그 이름 경계를 지켜 태그 시작 위치를 찾는다.
 *
 * ⚠ 왜 필요한가: indexOf('<th')는 <thead>에도 걸린다. 셀 깊이 매칭이 <thead>를
 *    여는 <th>로 세면 짝이 맞지 않아 cellEnd를 못 찾고, 그 행이 통째로 조용히 사라진다.
 *    현재 mammoth 1.13.0은 <thead>를 내지 않지만 package.json이 캐럿(^)이라
 *    마이너 업그레이드 한 번에 그렇게 바뀔 수 있다.
 *    태그 이름 바로 다음 문자가 '>' · 공백 · '/' 중 하나일 때만 같은 태그로 본다.
 *    (닫는 태그처럼 이미 '>'로 끝나는 문자열은 그 자체가 경계이므로 그대로 찾는다.)
 */
function indexOfTag(source, tag, from) {
  if (tag.endsWith('>')) return source.indexOf(tag, from)
  let i = from
  while (i <= source.length) {
    const hit = source.indexOf(tag, i)
    if (hit < 0) return -1
    const next = source[hit + tag.length]
    if (next === '>' || next === '/' || (next !== undefined && /\s/.test(next))) return hit
    i = hit + 1
  }
  return -1
}

/** HTML에서 바깥 표들의 범위를 찾는다(깊이 추적). */
function findTableRanges(html) {
  const ranges = []
  const source = String(html ?? '')
  let i = 0

  while (true) {
    // 다음 <table 태그 찾기
    const start = indexOfTag(source, '<table', i)
    if (start < 0) break

    let depth = 0
    let j = start

    while (j < source.length) {
      const nextOpen = indexOfTag(source, '<table', j)
      const nextClose = indexOfTag(source, '</table', j)

      // 닫히지 않은 표 — 거기서 멈춤
      if (nextClose < 0) {
        i = j + 1  // 다음 위치로 진행 (무한루프 방지)
        depth = 1  // 닫히지 않은 상태로 표시
        break
      }

      if (nextOpen >= 0 && nextOpen < nextClose) {
        // 열림이 먼저 → 깊이 증가
        depth++
        j = nextOpen + 6
      } else {
        // 닫힘이 먼저 → 깊이 감소
        depth--
        j = nextClose + 7
        if (depth === 0) {
          // 바깥 표의 끝 찾기
          const endPos = source.indexOf('>', j)
          if (endPos >= 0) {
            ranges.push({ start, end: endPos + 1 })
            i = endPos + 1
          }
          break
        }
      }
    }

    // depth != 0 (짝이 안 맞음) 이면 더 진행하지 않음
    if (depth !== 0) break
  }

  return ranges
}

/** HTML에서 특정 태그 쌍의 범위를 찾는다(깊이 추적). */
function findTagRanges(html, openTag, closeTag, startPos = 0) {
  const ranges = []
  const source = String(html ?? '')
  const openLen = openTag.length
  const closeLen = closeTag.length
  let i = startPos

  while (true) {
    const start = indexOfTag(source, openTag, i)
    if (start < 0) break

    let depth = 0
    let j = start

    while (j < source.length) {
      const nextOpen = indexOfTag(source, openTag, j)
      const nextClose = indexOfTag(source, closeTag, j)

      if (nextClose < 0) {
        depth = 1
        break
      }

      if (nextOpen >= 0 && nextOpen < nextClose) {
        depth++
        j = nextOpen + openLen
      } else {
        depth--
        j = nextClose + closeLen
        if (depth === 0) {
          ranges.push({ start, end: j })
          i = j
          break
        }
      }
    }

    if (depth !== 0) break
  }

  return ranges
}

/** docx HTML의 표들을 순서대로 행렬로 뽑는다. 표가 없으면 빈 배열. */
export function tablesFromHtml(html) {
  const out = []
  const source = String(html ?? '')
  const ranges = findTableRanges(source)

  for (const range of ranges) {
    const tableHtml = source.substring(range.start, range.end)
    const rows = []

    // 행(row) 범위 찾기
    const rowRanges = findTagRanges(tableHtml, '<tr', '</tr>', 0)
    for (const rowRange of rowRanges) {
      const rowHtml = tableHtml.substring(rowRange.start, rowRange.end)
      const cells = []

      // 순차 스캔: td와 th 중 먼저 나오는 것부터 처리 (중복 방지)
      let pos = 0
      while (pos < rowHtml.length) {
        const nextTd = indexOfTag(rowHtml, '<td', pos)
        const nextTh = indexOfTag(rowHtml, '<th', pos)

        // 더 이상 셀이 없으면 종료
        if (nextTd < 0 && nextTh < 0) break

        // 먼저 나오는 태그 결정
        let tagStart = -1
        let tagName = ''
        let closeTag = ''

        if (nextTd >= 0 && (nextTh < 0 || nextTd < nextTh)) {
          tagStart = nextTd
          tagName = 'td'
          closeTag = '</td>'
        } else if (nextTh >= 0) {
          tagStart = nextTh
          tagName = 'th'
          closeTag = '</th>'
        }

        if (tagStart < 0) break

        // 같은 태그 이름으로 깊이 매칭
        let depth = 0
        let j = tagStart
        let cellEnd = -1

        while (j < rowHtml.length) {
          const nextOpen = indexOfTag(rowHtml, `<${tagName}`, j)
          const nextClose = indexOfTag(rowHtml, closeTag, j)

          if (nextClose < 0) break

          if (nextOpen >= 0 && nextOpen < nextClose) {
            depth++
            j = nextOpen + tagName.length + 1
          } else {
            depth--
            j = nextClose + closeTag.length
            if (depth === 0) {
              cellEnd = j
              break
            }
          }
        }

        if (cellEnd < 0) break

        // 셀 내용 추출
        const cellHtml = rowHtml.substring(tagStart, cellEnd)
        const tagEndPos = cellHtml.indexOf('>')
        if (tagEndPos >= 0) {
          const cellContent = cellHtml.substring(tagEndPos + 1).replace(new RegExp(`</${tagName}>$`), '')
          cells.push(plainText(cellContent))
        }

        // 다음 셀 위치로 이동 (중첩 내용은 건너뜀)
        pos = cellEnd
      }

      if (cells.length > 0) rows.push(cells)
    }

    if (rows.length > 0) out.push({ name: `표 ${out.length + 1}`, rows })
  }

  return out
}

/** 표 바깥의 본문 텍스트. 블록 경계는 줄바꿈으로 남긴다. */
export function textOutsideTables(html) {
  const source = String(html ?? '')
  const ranges = findTableRanges(source)

  // 표 구간을 표시하기 위해 문자열 재구성
  let result = ''
  let lastEnd = 0

  for (const range of ranges) {
    // 표 앞의 텍스트
    result += source.substring(lastEnd, range.start)
    // 표 자리에 줄바꿈 삽입
    result += '\n'
    lastEnd = range.end
  }
  // 마지막 표 뒤의 텍스트
  result += source.substring(lastEnd)

  return result
    .replace(/<\/(?:p|div|h[1-6]|li|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((line) => decodeEntities(line).replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n')
}
