// server/modules/mailer/attachmentPath.test.js
import { describe, it, expect } from 'vitest'
import {
  MAX_FILE_SIZE, buildAttachmentPath, validateUploadRequest, hubIdOfPath,
} from './attachmentPath.js'

const HUB = '11111111-1111-4111-8111-111111111111'
const FOLDER = '22222222-2222-4222-8222-222222222222'

describe('buildAttachmentPath', () => {
  it('허브 id를 접두사로 붙인다 — 클라이언트가 접두사를 고를 수 없어야 허브 간 침범이 막힌다', () => {
    const path = buildAttachmentPath(HUB, FOLDER, '보고서.pdf')
    expect(path.startsWith(`${HUB}/${FOLDER}/`)).toBe(true)
    expect(path.endsWith('.pdf')).toBe(true)
  })

  it('저장 이름은 매번 다르다 — 같은 이름을 올려도 기존 파일을 덮어쓰지 않는다', () => {
    const a = buildAttachmentPath(HUB, FOLDER, 'a.png')
    const b = buildAttachmentPath(HUB, FOLDER, 'a.png')
    expect(a).not.toBe(b)
  })

  it('확장자가 없으면 점도 붙이지 않는다', () => {
    expect(buildAttachmentPath(HUB, FOLDER, 'README')).not.toContain('.')
  })

  it('확장자에 슬래시가 섞여 있으면 버린다 — 경로가 한 단 더 깊어지면 소유 판정이 어긋난다', () => {
    const path = buildAttachmentPath(HUB, FOLDER, 'a.pn/g')
    expect(path.split('/')).toHaveLength(3)
  })

  it('확장자 길이를 제한한다', () => {
    const path = buildAttachmentPath(HUB, FOLDER, 'a.' + 'x'.repeat(50))
    expect(path.split('.').pop().length).toBeLessThanOrEqual(16)
  })
})

describe('validateUploadRequest', () => {
  it('정상 요청은 통과한다', () => {
    expect(validateUploadRequest({ folder: FOLDER, filename: 'a.pdf', size: 100 })).toBeNull()
  })

  it('폴더가 UUID가 아니면 거절한다 — 상위 경로 탈출을 막는다', () => {
    expect(validateUploadRequest({ folder: '../other', filename: 'a.pdf', size: 1 })).toMatch(/폴더/)
  })

  it('10MB를 넘으면 거절한다 — 클라이언트 검사는 우회할 수 있다', () => {
    expect(validateUploadRequest({ folder: FOLDER, filename: 'a.pdf', size: MAX_FILE_SIZE + 1 })).toMatch(/10MB/)
  })

  it('크기가 숫자가 아니면 거절한다', () => {
    expect(validateUploadRequest({ folder: FOLDER, filename: 'a.pdf', size: 'many' })).toMatch(/크기/)
  })

  it('파일명이 없으면 거절한다', () => {
    expect(validateUploadRequest({ folder: FOLDER, filename: '', size: 1 })).toMatch(/파일명/)
  })
})

describe('hubIdOfPath', () => {
  it('새 경로에서 허브 id를 읽는다', () => {
    expect(hubIdOfPath(`${HUB}/${FOLDER}/x.png`)).toBe(HUB)
  })

  it('구 경로(2단)는 허브를 알 수 없다 — null을 준다', () => {
    expect(hubIdOfPath(`${FOLDER}/x.png`)).toBeNull()
  })

  it('빈 값·비문자열은 null', () => {
    expect(hubIdOfPath('')).toBeNull()
    expect(hubIdOfPath(undefined)).toBeNull()
  })
})
