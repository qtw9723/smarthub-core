// 외부 에디션 저장소 — supabase-js(서비스 롤). 영역별 함수는 각 파일에 있고 pg 구현과 이름이 같다(contract/parity.test.js).
import * as hubs from './hubs.js'
import * as features from './features.js'
import * as security from './security.js'
import * as calls from './calls.js'
import * as chatbots from './chatbots.js'
import * as checks from './checks.js'
import * as settings from './settings.js'
import * as authFailures from './authFailures.js'

export const repos = { hubs, features, security, calls, chatbots, checks, settings, authFailures }
