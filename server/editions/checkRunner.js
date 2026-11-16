// 챗봇 점검 실행기 — 외부는 GitHub Actions, 사내는 k8s Job. 쓰지 않는 쪽은 import하지 않는다.
//   available(): boolean · missing: 없을 때 안내에 쓰는 이름 · dispatch(inputs) → { ok, status, text() }
import { edition } from '../edition.js'

export const checkRunner = edition() === 'internal'
  ? await import('./internal/checkRunner.js')
  : await import('./external/checkRunner.js')
