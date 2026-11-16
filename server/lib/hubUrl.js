// server/lib/hubUrl.js — 메일에 싣는 앱 링크의 주소(챗봇 실패 알림).
//
// 사내(TEAM_HOST_SUFFIX)는 그 허브의 팀 주소 http://<허브키>.<접미사> — 팀원이 hosts에 넣은 주소가 그것이고,
// 관리자 주소(smarthub.example.com)는 팀원 PC에서 열리지 않는다(lib/teamHost.js). 사내망은 http다.
// 외부는 지금처럼 APP_BASE_URL > HUB_URL(Actions) > PUBLIC_URL > Vercel 운영 주소. 모르면 '' — 부르는 쪽이 링크를 뺀다.
export function hubBaseUrl(hubKey, env = process.env) {
  const suffix = (env.TEAM_HOST_SUFFIX ?? '').replace(/^\./, '')
  if (suffix) return `http://${hubKey}.${suffix}`
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${env.VERCEL_PROJECT_PRODUCTION_URL}` : ''
  return (env.APP_BASE_URL || env.HUB_URL || env.PUBLIC_URL || vercel).replace(/\/$/, '')
}

/** 허브 안 모듈 페이지 주소. 기본 주소를 모르면 ''. */
export function hubPageUrl(hubKey, featureKey, env = process.env) {
  const base = hubBaseUrl(hubKey, env)
  return base ? `${base}/hub/${hubKey}/${featureKey}` : ''
}
