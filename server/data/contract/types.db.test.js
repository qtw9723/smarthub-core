// 값의 모양 — 두 구현이 API 응답에 같은 타입을 내야 한다(supabase-js는 PostgREST JSON을 그대로 준다).
// timestamptz → ISO 문자열('T'·'+00:00'), date → 'YYYY-MM-DD' 문자열, bigint id → number.
import { it, expect } from 'vitest'
import { contractSuite } from './harness.js'
import { query } from '../pg/pool.js'
import { supabaseClient } from '../supabase/client.js'

contractSuite('types', ({ repos, sql }) => {
  it('timestamptz·date·bigint의 모양이 같다', async () => {
    const h = (await sql("insert into hubs (key, name, created_at) values ('ops', 'Ops', '2026-11-09T08:02:00.123456Z') returning id"))[0].id
    await sql("insert into hub_module_calls (hub_id, feature_key, called_at) values ($1, 'x', '2026-11-09T08:02:00.5Z')", [h])
    const viaPg = (await query('select h.created_at, c.id, c.called_at, current_date as d from hubs h join hub_module_calls c on c.hub_id = h.id')).rows[0]
    const { data } = await supabaseClient().from('hub_module_calls').select('id, called_at, hubs(created_at)').single()
    expect(viaPg.created_at).toBe(data.hubs.created_at)
    expect(viaPg.called_at).toBe(data.called_at)
    expect(typeof viaPg.id).toBe('number')
    expect(viaPg.id).toBe(data.id)
    expect(viaPg.d).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(repos()).toBeTruthy()
  })
})
