// 컬럼명 → 영문 snake_case 변환 (순수 모듈, 파싱 라이브러리·UI 무의존).
// toEnglishFieldName(name) → { name, converted }
//
// ⚠ 반쪽 변환 금지 — 사전에 없는 조각이 하나라도 있으면 원본을 그대로 돌려주고
// converted:false로 알린다. 일부만 영문으로 바뀐 이름은 "다 됐다"는 착각을 부른다.

// 한글 조각 → 영문 조각. 최장 일치로 조회하므로 긴 항목이 짧은 항목을 이긴다
// (예: '할인율'이 '할인'보다, '배송비'가 '배송'보다 먼저 잡힌다).
// ⚠ createdAt/updatedAt은 스키마 예약 열이므로 그 이름으로 매핑하지 않는다.
const DICT = {
  // 복합어 (최장 일치 우선)
  '담당부서': 'department', '비고사항': 'note', '인원수': 'headcount',
  '첨부파일': 'attachment_file', '배송지': 'shipping_address', '유효기간': 'valid_period',
  '전화번호': 'phone', '휴대폰번호': 'mobile', '핸드폰번호': 'mobile',
  '우편번호': 'zip_code', '생년월일': 'birth_date', '주민등록번호': 'ssn',
  '사업자번호': 'business_no', '계좌번호': 'account_no', '카드번호': 'card_no',
  '이메일주소': 'email', '배송비': 'shipping_fee', '할인율': 'discount_rate',
  '등록일': 'created_date', '등록일시': 'created_date', '수정일': 'updated_date',
  '시작일': 'start_date', '종료일': 'end_date', '주문일': 'order_date',
  '예약일': 'reservation_date', '결제일': 'payment_date', '배송일': 'delivery_date',

  // 사람
  '고객': 'customer', '회원': 'member', '사용자': 'user', '담당자': 'manager',
  '직원': 'employee', '작성자': 'writer', '수취인': 'receiver', '수령인': 'receiver',
  '예약자': 'reserver', '보호자': 'guardian',
  '이름': 'name', '성명': 'name', '성함': 'name', '명': 'name',

  // 연락·신원
  '전화': 'phone', '휴대폰': 'mobile', '핸드폰': 'mobile', '연락처': 'contact',
  '이메일': 'email', '메일': 'email', '주소': 'address', '생일': 'birthday',
  '나이': 'age', '성별': 'gender', '국가': 'country', '도시': 'city', '지역': 'region',

  // 거래
  '예약': 'reservation', '주문': 'order', '결제': 'payment', '배송': 'delivery',
  '반품': 'return', '교환': 'exchange', '취소': 'cancel', '문의': 'inquiry',
  '접수': 'receipt', '처리': 'process',

  // 식별자
  '번호': 'no', '코드': 'code', '아이디': 'id', '식별자': 'id',

  // 상품·수치
  '상품': 'product', '제품': 'product', '품목': 'item', '재고': 'stock',
  '수량': 'quantity', '개수': 'count', '가격': 'price', '금액': 'amount',
  '합계': 'total', '총': 'total', '할인': 'discount', '단가': 'unit_price', '세금': 'tax',

  // 시간
  '날짜': 'date', '일자': 'date', '일시': 'datetime', '시간': 'time',
  '기간': 'period', '요일': 'weekday',

  // 분류·상태
  '상태': 'status', '구분': 'type', '유형': 'type', '종류': 'type',
  '분류': 'category', '카테고리': 'category', '등급': 'grade', '레벨': 'level',
  '순번': 'seq', '순위': 'rank',

  // 텍스트
  '메모': 'memo', '비고': 'note', '내용': 'content', '제목': 'title',
  '설명': 'description', '사유': 'reason', '요청': 'request',
  '답변': 'answer', '질문': 'question',

  // 조직·장소
  '회사': 'company', '부서': 'department', '지점': 'branch', '매장': 'store',
  '창고': 'warehouse', '위치': 'location', '장소': 'place',
  '위도': 'latitude', '경도': 'longitude', '좌표': 'coordinate',

  // 상태 플래그의 어간
  '가입': 'signup', '동의': 'agreement', '사용': 'use', '활성': 'active',
  '완료': 'complete', '확인': 'confirm', '유효': 'valid',

  // 기타
  '포인트': 'point', '적립': 'reward', '쿠폰': 'coupon', '비율': 'rate',
  '파일': 'file', '이미지': 'image', '링크': 'link', '경로': 'path',

  // ── 2026-07-23 확장 — 실무 헤더에서 조각 하나가 없어 통째로 실패하던 어휘 ──
  // 업무 진행
  '담당': 'manager', '신청': 'request', '상담': 'consultation', '민원': 'complaint',
  '회신': 'reply', '응답': 'response', '발송': 'send', '수신': 'receive',
  '등록': 'register', '변경': 'change', '삭제': 'delete', '진행': 'progress',
  '결과': 'result', '내역': 'detail', '이력': 'history', '첨부': 'attachment',

  // 사물·속성
  '서비스': 'service', '차량': 'vehicle', '객실': 'room', '좌석': 'seat',
  '타입': 'type', '수단': 'method', '방법': 'method', '사항': 'item',
  '항목': 'item', '대상': 'target', '단위': 'unit', '옵션': 'option',
  '색상': 'color', '사이즈': 'size', '규격': 'spec', '브랜드': 'brand',
  '모델': 'model', '제조사': 'manufacturer', '수량단위': 'unit',

  // 사람·조직
  '인원': 'headcount', '창구': 'counter', '팀': 'team', '그룹': 'group',
  '권한': 'permission', '역할': 'role',

  // 행위
  '이용': 'usage', '방문': 'visit', '출발': 'departure', '도착': 'arrival',
  '시작': 'start', '종료': 'end', '예매': 'booking', '계약': 'contract',

  // 금전
  '청구': 'billing', '환불': 'refund', '입금': 'deposit', '출금': 'withdrawal',
  '잔액': 'balance', '매출': 'sales', '매입': 'purchase', '할부': 'installment',

  // 평가·소통
  '만족도': 'satisfaction', '평점': 'rating', '점수': 'score', '후기': 'review',
  '댓글': 'comment', '메시지': 'message', '알림': 'notification', '채널': 'channel',

  // 잡다
  '기타': 'etc', '값': 'value', '최초': 'first', '최종': 'last',
  '우선순위': 'priority', '관리': 'management', '사진': 'photo', '로그': 'log',
}

// 접미로 붙으면 결과를 is_ 접두로 바꾸는 조각.
const IS_SUFFIXES = ['여부', '유무']

const MAX_TOKEN_LEN = 6
const HANGUL_RE = /[가-힣]/

function snakeAscii(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase())
    .join('_')
}

function tidy(parts) {
  return parts.join('_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase()
}

/**
 * @param {string} raw
 * @returns {{ name: string, converted: boolean }}
 */
export function toEnglishFieldName(raw) {
  const input = String(raw ?? '')
  if (input.trim() === '') return { name: input, converted: false }

  // 한글이 없으면 ASCII 규칙만 적용한다.
  if (!HANGUL_RE.test(input)) {
    const snake = snakeAscii(input)
    return snake === '' ? { name: input, converted: false } : { name: snake, converted: true }
  }

  const parts = []
  let isFlag = false
  let i = 0

  while (i < input.length) {
    const ch = input[i]

    // 구분자는 조각 경계로만 쓰고 버린다.
    if (/[\s_\-./]/.test(ch)) { i += 1; continue }

    if (HANGUL_RE.test(ch)) {
      let matched = ''
      for (let len = Math.min(MAX_TOKEN_LEN, input.length - i); len >= 1; len -= 1) {
        const slice = input.slice(i, i + len)
        if (Object.prototype.hasOwnProperty.call(DICT, slice) || IS_SUFFIXES.includes(slice)) {
          matched = slice
          break
        }
      }
      // 사전에 없는 한글 조각 → 반쪽 변환을 피해 전체를 포기한다.
      if (matched === '') return { name: input, converted: false }

      if (IS_SUFFIXES.includes(matched)) isFlag = true
      else parts.push(DICT[matched])
      i += matched.length
      continue
    }

    // ASCII 구간은 통째로 모아 snake로 변환한다.
    let j = i
    while (j < input.length && !HANGUL_RE.test(input[j]) && !/[\s_\-./]/.test(input[j])) j += 1
    const ascii = snakeAscii(input.slice(i, j))
    if (ascii !== '') parts.push(ascii)
    i = j
  }

  if (parts.length === 0) return { name: input, converted: false }

  const name = tidy(isFlag ? ['is', ...parts] : parts)
  return { name, converted: true }
}

/**
 * 필드 스펙 맵의 이름을 일괄 영문 변환한다.
 *
 * ⚠ 이 함수가 따로 존재하는 이유: 예전에는 이 로직이 React `setFieldSpecs` 업데이터
 * 안에 있었고, 실패 개수를 업데이터 밖에서 즉시 읽었다. 업데이터는 렌더 시점에
 * 실행되므로 그 값은 항상 0이었고 — 아무것도 변환되지 않아도 "모두 변환했습니다"가
 * 떴다. 순수 함수로 분리해 실패 목록을 반환값으로 돌려주면 타이밍 문제가 사라진다.
 *
 * @param {Record<string, { include?: boolean, outputName?: string }>} fieldSpecs
 * @returns {{ fieldSpecs: Record<string, object>, failed: string[] }} failed = 변환하지 못한 원본 컬럼명
 */
export function applyEnglishNames(fieldSpecs) {
  const next = {}
  const failed = []
  for (const [name, spec] of Object.entries(fieldSpecs || {})) {
    if (spec?.include === false) { next[name] = spec; continue }
    const r = toEnglishFieldName(spec?.outputName || name)
    if (!r.converted) failed.push(name)
    next[name] = { ...spec, outputName: r.name }
  }
  return { fieldSpecs: next, failed }
}
