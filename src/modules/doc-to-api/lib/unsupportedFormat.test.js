import { assertEquals, Deno } from "../../sheet-to-schema/lib/denoShim.js"
import { unsupportedFormatMessage } from './unsupportedFormat.js'

Deno.test('hwp는 PDF·워드 저장을 안내한다', () => {
  const msg = unsupportedFormatMessage('hwp')
  assertEquals(msg.includes('PDF'), true, msg)
  assertEquals(msg.includes('.docx'), true, msg)
})

Deno.test('hwpx도 같은 안내', () => {
  assertEquals(unsupportedFormatMessage('hwpx'), unsupportedFormatMessage('hwp'))
})

Deno.test('구 워드 .doc은 .docx 저장을 안내한다', () => {
  const msg = unsupportedFormatMessage('doc')
  assertEquals(msg.includes('.docx'), true, msg)
  // .doc 안내에 PDF를 섞지 않는다 — .docx 한 가지만 말하는 편이 행동으로 옮기기 쉽다.
  assertEquals(msg.includes('PDF'), false, msg)
})

Deno.test('파워포인트는 PDF 저장을 안내한다', () => {
  const msg = unsupportedFormatMessage('pptx')
  assertEquals(msg.includes('PDF'), true, msg)
  assertEquals(unsupportedFormatMessage('ppt'), msg)
})

Deno.test('모르는 확장자는 기존 문구를 유지한다', () => {
  assertEquals(unsupportedFormatMessage('zip'), '지원하지 않는 파일 형식입니다: .zip')
})

Deno.test('대문자 확장자도 같게 처리한다', () => {
  assertEquals(unsupportedFormatMessage('HWP'), unsupportedFormatMessage('hwp'))
})
