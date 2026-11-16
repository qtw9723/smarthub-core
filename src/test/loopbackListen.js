// 테스트 전용: supertest가 요청할 주소를 서버가 실제로 붙은 주소와 맞춘다.
//
// supertest는 app.listen(0)으로 `[::]`(IPv6 전체)에 붙고 요청은 `127.0.0.1:<포트>`(IPv4)로 보낸다. macOS에서는 다른 테스트
// 프로세스가 같은 포트 번호를 127.0.0.1로 따로 잡을 수 있고, 그러면 요청이 **그 프로세스**로 간다 — vitest가 파일을
// 병렬로 돌릴 때 간헐 실패(남의 앱이 401·404를 답함)의 원인이었다(2026-11-09 리뷰에서 규명).
// 서버가 IPv6로 붙었으면 `[::1]`로 요청한다 — 그 소켓은 이 프로세스만 가진다.
// (서버를 127.0.0.1에 붙이는 쪽은 바인딩이 비동기가 되어 supertest가 바로 읽는 포트가 비므로 쓰지 않는다)
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const Test = require('supertest/lib/test.js')
const serverAddress = Test.prototype.serverAddress
Test.prototype.serverAddress = function loopbackServerAddress(app, path) {
  const url = serverAddress.call(this, app, path)
  const addr = app.address?.()
  if (addr && addr.family === 'IPv6' && (addr.address === '::' || addr.address === '::1')) {
    return url.replace('://127.0.0.1:', '://[::1]:')
  }
  return url
}
