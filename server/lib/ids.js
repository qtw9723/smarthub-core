// server/lib/ids.js — 경로 파라미터의 **형식**을 라우터에서 먼저 본다.
//
// 왜 필요한가: DB 컬럼이 uuid/bigint인데 잘못된 문자열을 그대로 쿼리에 넘기면
// Postgres가 22P02로 던지고, 라우터의 catch가 그것을 **500 + 원문 오류 메시지**로 내보낸다:
//   GET /log-types/not-a-uuid → 500 {"error":"invalid input syntax for type uuid: \"not-a-uuid\""}
// 이것은 두 가지가 잘못됐다. 클라이언트 잘못인데 서버 오류(5xx)로 보고하고,
// 내부 스키마(어느 컬럼이 무슨 타입인지)를 응답에 흘린다.
// 형식이 틀린 값은 **존재할 수 없는 값**이므로, 조회하기 전에 400으로 끊는다.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v)

// bigint 키. Number로 바꾸면 2^53을 넘는 값이 뭉개지므로 문자열 형태만 본다.
export const isIntId = (v) => typeof v === 'string' && /^[1-9][0-9]*$/.test(v)
