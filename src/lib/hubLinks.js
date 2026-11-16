// 특정 허브를 기존(외부) 앱 UI로 연결하는 매핑. 현재는 없음 —
// 나중에 특정 허브를 외부 앱으로 연결하려면 여기에 {key: url} 추가.
export const EXTERNAL_HUBS = {}

export const hubExternalUrl = (key) => EXTERNAL_HUBS[key] ?? null
