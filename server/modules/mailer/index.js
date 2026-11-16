// server/modules/mailer/index.js
import router from './router.js'
import { repos } from '../../data/index.js'
async function overview(hubId) {
  // 조회 실패는 빈 목록으로 보여 준다(이전 동작).
  const items = await repos.mailer.listJobSummaries(hubId).catch(() => [])
  return { summary: { job_count: items.length, active_count: items.filter(j => j.is_active).length }, items }
}
export default { key: 'mailer', apiRouter: router, overview }
