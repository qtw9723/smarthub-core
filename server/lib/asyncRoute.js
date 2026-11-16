// server/lib/asyncRoute.js — async 라우트 핸들러의 안전망.
//
// 문제: Express 4는 async 핸들러가 돌려준 프로미스의 **거부를 잡지 않는다.**
// 핸들러가 try 밖에서 던지면 응답이 만들어지지 않고 요청이 그대로 매달린다.
// 서버리스에서는 그 호출이 maxDuration(60초)을 다 쓰고 504로 죽는다 —
// 잘못된 쿼리 파라미터 하나가 호출 한 번을 통째로 태운다.
//
// 실측(2026-09-15, 프로덕션):
//   GET /api/modules/chatbot-monitoring/bots?hub=cs&id=not-a-uuid
//     → 504 FUNCTION_INVOCATION_TIMEOUT (60초)
//   원인: 라우트가 `await resolveSource(...)`를 try **밖에서** 부르는데,
//        그 안의 `.eq('id', 'not-a-uuid')`가 Postgres 22P02로 던진다.
//
// 개별 라우트에서 try를 빠뜨리지 않는 것에 기대지 않고, 라우터 차원에서 막는다.

/** 핸들러가 던지든 거부하든 next(err)로 보낸다. */
export function catchAsync(handler) {
  return function wrapped(req, res, next) {
    try {
      return Promise.resolve(handler(req, res, next)).catch(next)
    } catch (e) {
      return next(e) // 동기 throw
    }
  }
}

const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'all']

/**
 * 이 라우터에 **이후로** 정의되는 모든 라우트를 catchAsync로 감싸고,
 * 끝에 오류 미들웨어를 단다. 라우트를 정의하기 전에 호출할 것.
 *
 * 오류 응답에 `e.message`를 싣지 않는다 — DB 오류 원문은 내부 스키마를 드러낸다
 * (`invalid input syntax for type uuid: ...`처럼 어느 컬럼이 무슨 타입인지 알려준다).
 */
export function guardAsyncRouter(router, label = 'router') {
  for (const verb of VERBS) {
    const original = router[verb].bind(router)
    router[verb] = (path, ...handlers) =>
      original(path, ...handlers.map((h) => (typeof h === 'function' ? catchAsync(h) : h)))
  }
  // 오류 미들웨어는 라우트보다 뒤에 있어야 하지만, Express는 등록 순서를 지키므로
  // 라우터가 마운트될 때 마지막에 실행되도록 여기서 미리 걸어 두면 안 된다.
  // 대신 finalizeAsyncRouter로 명시적으로 닫는다.
  router.__asyncLabel = label
  return router
}

/** 라우트 정의가 모두 끝난 뒤 호출 — 오류 미들웨어를 라우터 끝에 단다. */
export function finalizeAsyncRouter(router) {
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err)
    console.error(`[${router.__asyncLabel ?? 'router'}] ${req.method} ${req.originalUrl}`, err)
    res.status(500).json({ error: '처리 중 오류가 발생했습니다' })
  })
  return router
}
