import { assertEquals, Deno } from "../../sheet-to-schema/lib/denoShim.js"
import { tablesFromHtml, textOutsideTables } from './docxTables.js'

Deno.test('표 하나를 행렬로 뽑는다', () => {
  const html = '<table><tr><td>시나리오</td><td>진입발화</td></tr><tr><td>배송조회</td><td>배송 알려줘</td></tr></table>'
  assertEquals(tablesFromHtml(html), [
    { name: '표 1', rows: [['시나리오', '진입발화'], ['배송조회', '배송 알려줘']] },
  ])
})

Deno.test('표가 여러 개면 순서대로 번호가 붙는다', () => {
  const html = '<table><tr><td>A</td></tr></table><p>사이</p><table><tr><td>B</td></tr></table>'
  const out = tablesFromHtml(html)
  assertEquals(out.length, 2)
  assertEquals(out[0].name, '표 1')
  assertEquals(out[1].name, '표 2')
  assertEquals(out[1].rows, [['B']])
})

Deno.test('th도 셀로 취급한다', () => {
  const html = '<table><tr><th>머리</th><th>글</th></tr><tr><td>값1</td><td>값2</td></tr></table>'
  assertEquals(tablesFromHtml(html)[0].rows, [['머리', '글'], ['값1', '값2']])
})

Deno.test('셀 안의 태그는 벗기고 텍스트만 남긴다', () => {
  const html = '<table><tr><td><p><strong>굵게</strong></p></td></tr></table>'
  assertEquals(tablesFromHtml(html)[0].rows, [['굵게']])
})

Deno.test('HTML 엔티티를 디코드한다', () => {
  const html = '<table><tr><td>A&amp;B</td><td>&lt;태그&gt;</td><td>&nbsp;</td></tr></table>'
  assertEquals(tablesFromHtml(html)[0].rows, [['A&B', '<태그>', '']])
})

Deno.test('표가 없으면 빈 배열', () => {
  assertEquals(tablesFromHtml('<p>문단만 있음</p>'), [])
})

Deno.test('표 바깥 텍스트만 따로 뽑는다', () => {
  const html = '<p>앞 설명</p><table><tr><td>표안</td></tr></table><p>뒤 설명</p>'
  assertEquals(textOutsideTables(html), '앞 설명\n뒤 설명')
})

Deno.test('표 바깥이 비면 빈 문자열', () => {
  assertEquals(textOutsideTables('<table><tr><td>표안</td></tr></table>'), '')
})

Deno.test('빈 입력도 던지지 않는다', () => {
  assertEquals(tablesFromHtml(''), [])
  assertEquals(textOutsideTables(''), '')
})

Deno.test('셀이 하나도 없는 표는 결과에 포함되지 않는다', () => {
  const html = '<table></table>'
  assertEquals(tablesFromHtml(html), [])
})

Deno.test('행은 있으나 셀이 없는 표도 결과에 포함되지 않는다', () => {
  const html = '<table><tr></tr></table>'
  assertEquals(tablesFromHtml(html), [])
})

Deno.test('빈 표가 중간에 끼어도 뒤 표의 번호가 밀리지 않는다', () => {
  const html = '<table></table><table><tr><td>A</td></tr></table>'
  const out = tablesFromHtml(html)
  assertEquals(out.length, 1)
  assertEquals(out[0].name, '표 1')
  assertEquals(out[0].rows, [['A']])
})

Deno.test('중첩 표는 바깥 표만 나오고 모든 셀이 보존된다', () => {
  const html = '<table><tr><td>바깥1</td><td><table><tr><td>안쪽</td></tr></table>안쪽셀 뒷부분</td><td>바깥2</td></tr></table>'
  const out = tablesFromHtml(html)
  assertEquals(out.length, 1)
  assertEquals(out[0].name, '표 1')
  // 안쪽 표 태그가 벗겨져서 "안쪽 안쪽셀 뒷부분"으로 평탄화됨
  assertEquals(out[0].rows, [['바깥1', '안쪽 안쪽셀 뒷부분', '바깥2']])
})

Deno.test('중첩 표의 안쪽 내용이 셀 텍스트에 남아 있다', () => {
  const html = '<table><tr><td>앞<table><tr><td>안쪽_데이터</td></tr></table>뒤</td></tr></table>'
  const out = tablesFromHtml(html)
  assertEquals(out.length, 1)
  // 안쪽 표이 평탄화되면서 "앞 안쪽_데이터 뒤"가 됨
  const cellText = out[0].rows[0][0]
  assertEquals(cellText.includes('안쪽_데이터'), true)
})

Deno.test('중첩 표가 있어도 textOutsideTables에 표 내용이 새어나오지 않는다', () => {
  const html = '<p>앞</p><table><tr><td>바깥1<table><tr><td>안쪽</td></tr></table>바깥1뒤</td><td>바깥2</td></tr></table><p>뒤</p>'
  const prose = textOutsideTables(html)
  // 표 안에 있던 모든 문자열은 본문에 나타나면 안 된다
  for (const leaked of ['바깥1', '안쪽', '바깥1뒤', '바깥2']) {
    assertEquals(prose.includes(leaked), false, `본문으로 샌 표 내용: ${leaked} (본문=${prose})`)
  }
  assertEquals(prose, '앞\n뒤')
})

Deno.test('닫히지 않은 표가 있어도 던지지 않고 그 전까지 표만 반환한다', () => {
  const html = '<table><tr><td>완성</td></tr></table><table><tr><td>미완성'
  const out = tablesFromHtml(html)
  assertEquals(out.length, 1)
  assertEquals(out[0].rows, [['완성']])
})

Deno.test('나머지 HTML 엔티티를 디코드한다', () => {
  const html = '<table><tr><td>&quot;따옴표&quot;</td><td>&#39;작은따옴표&#39;</td><td>&apos;홑따옴표&apos;</td></tr></table>'
  assertEquals(tablesFromHtml(html)[0].rows, [['"따옴표"', "'작은따옴표'", "'홑따옴표'"]])
})

Deno.test('바깥 td 안쪽 중첩 표에 th가 있으면 1셀만 나온다', () => {
  const html = '<table><tr><td>A<table><tr><th>H</th></tr></table>B</td></tr></table>'
  const out = tablesFromHtml(html)
  assertEquals(out.length, 1)
  assertEquals(out[0].rows.length, 1)  // 1행
  assertEquals(out[0].rows[0].length, 1)  // 1셀
  assertEquals(out[0].rows[0][0].includes('H'), true)  // H가 포함됨
})

Deno.test('바깥 th 안쪽 중첩 표에 td가 있으면 1셀만 나온다', () => {
  const html = '<table><tr><th>Header<table><tr><td>Inner</td></tr></table>Footer</th></tr></table>'
  const out = tablesFromHtml(html)
  assertEquals(out.length, 1)
  assertEquals(out[0].rows.length, 1)
  assertEquals(out[0].rows[0].length, 1)  // 1셀 — 중복 없음
  assertEquals(out[0].rows[0][0].includes('Inner'), true)
})

Deno.test('같은 행에 td와 th가 나란히 있으면 둘 다 순서대로 나온다', () => {
  const html = '<table><tr><th>Header</th><td>Data</td></tr></table>'
  const out = tablesFromHtml(html)
  assertEquals(out.length, 1)
  assertEquals(out[0].rows.length, 1)
  assertEquals(out[0].rows[0].length, 2)  // 2셀
  assertEquals(out[0].rows[0][0], 'Header')
  assertEquals(out[0].rows[0][1], 'Data')
})

// ⚠ 태그 이름 경계 — indexOf('<th')는 <thead>에도 걸린다.
//    경계 검사가 없으면 <thead>가 여는 <th>로 세어져 셀 깊이 매칭이 어긋나고,
//    그 행이 통째로 조용히 사라진다. mammoth는 지금 <thead>를 내지 않지만
//    package.json이 캐럿(^1.13.0)이라 마이너 업그레이드 한 번에 바뀔 수 있다.
Deno.test('<thead>가 섞인 표에서 행이 사라지지 않는다', () => {
  const html =
    '<table><thead><tr><th>구분</th><th>내용</th></tr></thead>' +
    '<tbody><tr><td>배송조회</td><td>배송 알려줘</td></tr></tbody></table>'
  assertEquals(tablesFromHtml(html), [
    { name: '표 1', rows: [['구분', '내용'], ['배송조회', '배송 알려줘']] },
  ])
})

Deno.test('th 셀 안 중첩 표가 <thead>를 써도 바깥 행이 사라지지 않는다', () => {
  const html =
    '<table><tr><th>Header' +
    '<table><thead><tr><td>Inner</td></tr></thead></table>' +
    'Footer</th></tr></table>'
  const out = tablesFromHtml(html)
  assertEquals(out.length, 1)
  assertEquals(out[0].rows.length, 1)   // 행이 통째로 버려지면 0이 된다
  assertEquals(out[0].rows[0].length, 1)
  assertEquals(out[0].rows[0][0].includes('Inner'), true)
  assertEquals(out[0].rows[0][0].includes('Footer'), true)
})
