// API 정의(api_def) 편집 공통 모듈 — ApiGenPage와 SchemaEditor가 함께 사용한다.
// 팔레트는 SmartHub 테마 토큰(src/index.css의 @theme)으로 옮겼다 — 원본의 #0052CC·
// #E5E7EB 같은 밝은 테마 값을 쓰면 어두운 배경에서 대비가 무너진다.
export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
export const CONTENT_TYPES = ['json', 'form', 'query']

// select에는 [color-scheme:dark]가 필요하다 — 없으면 네이티브 드롭다운 목록만 흰색으로 뜬다.
const field = 'w-full rounded-lg border border-border-strong bg-bg-base px-2 py-1 text-sm text-text-primary placeholder:text-text-faint [color-scheme:dark] focus:outline-none focus:border-accent'
const cell = 'rounded-lg border border-border-strong bg-bg-base px-2 py-1 text-sm text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent'
const label = 'mb-1 block text-xs font-semibold text-text-secondary'

export function blankDef() {
  return {
    name: '', description: '', method: 'GET', contentType: 'query',
    content: [], headers: [], params: [],
    result: { type: 'json', _error: '', _result: '' },
    url: '', authType: 'noAuth', authParams: {},
  }
}

export function KvEditor({ label: labelText, rows, onChange }) {
  const list = Array.isArray(rows) ? rows : []
  const set = (i, k, v) => onChange(list.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)))
  return (
    <div>
      <label className={label}>{labelText}</label>
      {list.map((r, i) => (
        <div key={i} className="mb-1 flex gap-2">
          <input value={r.key || ''} onChange={(e) => set(i, 'key', e.target.value)} placeholder="key" className={`w-1/3 ${cell}`} />
          <input value={r.value || ''} onChange={(e) => set(i, 'value', e.target.value)} placeholder="value" className={`flex-1 ${cell}`} />
          <button type="button" onClick={() => onChange(list.filter((_, idx) => idx !== i))} className="px-2 text-sm text-text-faint hover:text-status-error">×</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...list, { key: '', value: '' }])} className="text-xs text-accent hover:text-accent-hover">+ {labelText} 추가</button>
    </div>
  )
}

export function ParamEditor({ rows, onChange }) {
  const list = Array.isArray(rows) ? rows : []
  const set = (i, k, v) => onChange(list.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)))
  return (
    <div>
      <label className={label}>파라미터 (경로/쿼리)</label>
      {list.map((r, i) => (
        <div key={i} className="mb-1 flex gap-2">
          <input value={r.name || ''} onChange={(e) => set(i, 'name', e.target.value)} placeholder="name" className={`w-1/3 ${cell}`} />
          <input value={r.desc || ''} onChange={(e) => set(i, 'desc', e.target.value)} placeholder="설명" className={`flex-1 ${cell}`} />
          <button type="button" onClick={() => onChange(list.filter((_, idx) => idx !== i))} className="px-2 text-sm text-text-faint hover:text-status-error">×</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...list, { name: '', desc: '' }])} className="text-xs text-accent hover:text-accent-hover">+ 파라미터 추가</button>
    </div>
  )
}

export function ApiDefCard({ def, index, onChange, onRemove }) {
  const set = (patch) => onChange({ ...def, ...patch })
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-raised p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-secondary">API {index + 1}</span>
        <button type="button" onClick={onRemove} className="text-sm text-text-faint hover:text-status-error">삭제</button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className={label}>이름(영문)</label>
          <input value={def.name || ''} onChange={(e) => set({ name: e.target.value })} className={field} />
        </div>
        <div>
          <label className={label}>method</label>
          <select value={def.method || 'GET'} onChange={(e) => set({ method: e.target.value })} className={field}>
            {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={label}>설명</label>
        <input value={def.description || ''} onChange={(e) => set({ description: e.target.value })} className={field} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className={label}>URL</label>
          <input value={def.url || ''} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.example.com/users/${id}" className={field} />
        </div>
        <div>
          <label className={label}>contentType</label>
          <select value={def.contentType || 'query'} onChange={(e) => set({ contentType: e.target.value })} className={field}>
            {CONTENT_TYPES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <KvEditor label="헤더" rows={def.headers} onChange={(rows) => set({ headers: rows })} />
      <KvEditor label="바디 · 쿼리" rows={def.content} onChange={(rows) => set({ content: rows })} />
      <ParamEditor rows={def.params} onChange={(rows) => set({ params: rows })} />
    </div>
  )
}
