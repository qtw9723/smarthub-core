// 하네스 연기 시험 — 두 구현 경로(pg 직접 · PostgREST 경유)가 같은 DB를 본다.
import { it, expect } from 'vitest'
import { contractSuite } from './harness.js'
import { query } from '../pg/pool.js'
import { supabaseClient } from '../supabase/client.js'

contractSuite('smoke', ({ sql }) => {
  it('두 경로 모두 시드한 허브를 본다', async () => {
    await sql("insert into hubs (key, name) values ('ops', 'Ops')")
    expect((await query('select key from hubs')).rows).toEqual([{ key: 'ops' }])
    const { data, error } = await supabaseClient().from('hubs').select('key')
    expect(error).toBeNull()
    expect(data).toEqual([{ key: 'ops' }])
  })
})
