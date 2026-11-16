// Deno 테스트 → vitest 어댑터 (신규 작성, 이식 아님).
// 원본의 동반 테스트는 Deno.test + assertEquals로 작성돼 있다. 본문 260개 호출을
// 고쳐 쓰는 대신 여기서 어휘만 매핑해, 이식된 테스트를 원본과 거의 동일하게 유지한다.
import { it, expect } from 'vitest'

// Deno의 assertEquals는 deep equality — vitest의 toStrictEqual이 정확한 대응이다.
// ⚠ 다만 toStrictEqual이 더 엄격한 축이 있다: 프로토타입·클래스 인스턴스 일치와
// sparse array의 빈 슬롯(undefined 값과 구분)을 따진다. 이 디렉터리의 픽스처는 현재
// 전부 plain object/array/스칼라라 차이가 드러나지 않지만, 앞으로 Date·클래스 인스턴스·
// sparse array를 쓰는 픽스처가 생기면 이 매핑(toStrictEqual → toEqual 등)을 재검토해야 한다.
export const assertEquals = (actual, expected, msg) => expect(actual, msg).toStrictEqual(expected)

// 상류가 7bfe07b에서 쓰기 시작했다(중복 헤더가 서로 다른 키로 유일화됐는지 확인하는 단언).
export const assertNotEquals = (actual, expected, msg) => expect(actual, msg).not.toStrictEqual(expected)

// vitest는 top-level it()을 허용하므로 describe 래핑 없이 그대로 매핑된다.
export const Deno = { test: (name, fn) => it(name, fn) }
