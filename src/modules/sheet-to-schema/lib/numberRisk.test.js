import { assertEquals , Deno } from './denoShim.js'
import { numberRisksOf, detectNumberRisks } from './numberRisk.js'

Deno.test('numberRisksOf: 선행 0은 경고', () => {
  const risks = numberRisksOf(['00123', '00124'])
  assertEquals(risks.length, 1)
  assertEquals(risks[0].includes('선행 0'), true)
})

Deno.test('numberRisksOf: 16자리 이상 정수는 정밀도 경고', () => {
  const risks = numberRisksOf(['12345678901234567'])
  assertEquals(risks.length, 1)
  assertEquals(risks[0].includes('정밀도'), true)
})

Deno.test('numberRisksOf: 평범한 숫자는 경고 없음', () => {
  assertEquals(numberRisksOf(['1000', '3.14', '-5', '1E+5']), [])
  assertEquals(numberRisksOf([]), [])
})

Deno.test('numberRisksOf: 0·0.5는 선행 0으로 보지 않는다', () => {
  assertEquals(numberRisksOf(['0', '0.5', '-0']), [])
})

Deno.test('detectNumberRisks: number 타입 컬럼만 검사', () => {
  const sheet = {
    headers: ['사원번호', '우편번호'],
    rows: [{ 사원번호: '00123', 우편번호: '06236' }],
  }
  const specs = { 사원번호: { type: 'number' }, 우편번호: { type: 'string' } }
  const risks = detectNumberRisks(sheet, specs)
  assertEquals(Object.keys(risks), ['사원번호'])
})
