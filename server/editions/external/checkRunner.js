// 챗봇 점검 실행기(외부) — GitHub Actions 워크플로우 디스패치(chatbot-check.yml). 라우터에 있던 호출을 그대로 옮겼다.
// inputs 비우면 해당 허브 전체 체크.
export const available = () => Boolean(process.env.GITHUB_TOKEN)
export const missing = 'GITHUB_TOKEN'

export function dispatch(inputs) {
  const repo = process.env.GITHUB_REPO ?? 'qtw9723/smarthub'
  return fetch(`https://api.github.com/repos/${repo}/actions/workflows/chatbot-check.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'smarthub',
    },
    body: JSON.stringify({ ref: 'main', inputs }),
  })
}
