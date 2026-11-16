// apiDocToDef: 파싱된 OpenAPI 3.x 객체 → api_def[](엔드포인트당 1개).
// 산출 필드 집합은 skeletonApiDef(deriveApiDefs.ts)와 정확히 동일.
// UI 무관 순수 함수 — deno test 대상.

function toUrlTemplate(path) {
  return (path || "").replace(/\{([^}]+)\}/g, "${$1}")
}

function slugify(method, path) {
  const base = `${method}_${path}`.replace(/[^a-zA-Z0-9가-힣]+/g, "_").replace(/^_+|_+$/g, "")
  return base || "customApi"
}

function deriveName(op, method, path) {
  const id = op.operationId
  if (id && typeof id === "string" && id.trim()) return id.trim()
  return slugify(method, path)
}

function deriveDescription(op) {
  return String(op.summary || op.description || "").trim()
}

// OpenAPI schema.properties → [{key, value}]
function schemaToContent(schema) {
  if (!schema || typeof schema !== "object") return []
  const props = schema.properties
  if (!props || typeof props !== "object") return []
  return Object.entries(props).map(([key, def]) => ({
    key,
    value: typeof def?.example !== "undefined" ? String(def.example) : "",
  }))
}

// parameters 배열 → { params, queryContent, headers }
// 경로 파라미터: params에만(url에 ${param} 형태로 유지, content 미포함)
// 쿼리 파라미터: params + content 양쪽
// 헤더 파라미터: headers 배열
function parseParameters(parameters) {
  const params = []
  const queryContent = []
  const headers = []
  for (const p of (parameters || [])) {
    if (!p || typeof p !== "object") continue
    const name = String(p.name || "")
    if (!name) continue
    if (p.in === "path" || p.in === "query") {
      params.push({ name, desc: String(p.description || "") })
    }
    if (p.in === "query") {
      queryContent.push({ key: name, value: "" })
    }
    if (p.in === "header") {
      headers.push({ key: name, value: "" })
    }
  }
  return { params, queryContent, headers }
}

// method + requestBody → { contentType, content }
// GET/DELETE: query, content = 쿼리 파라미터 KV
// 그 외: requestBody 미디어 타입 기준(form > json 우선순위)
function deriveBodyInfo(method, requestBody, queryContent) {
  const m = (method || "").toLowerCase()
  if (m === "get" || m === "delete") {
    return { contentType: "query", content: queryContent }
  }
  if (requestBody && typeof requestBody === "object") {
    const ct = requestBody.content || {}
    if (ct["application/x-www-form-urlencoded"]) {
      return { contentType: "form", content: schemaToContent(ct["application/x-www-form-urlencoded"].schema) }
    }
    if (ct["application/json"]) {
      return { contentType: "json", content: schemaToContent(ct["application/json"].schema) }
    }
  }
  return { contentType: "json", content: [] }
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"]

export function apiDocToDef(openApiObj) {
  if (!openApiObj || typeof openApiObj !== "object") return []
  if (typeof openApiObj.openapi !== "string") return []
  if (!openApiObj.paths || typeof openApiObj.paths !== "object") return []

  const baseUrl = Array.isArray(openApiObj.servers) && openApiObj.servers.length > 0
    ? String(openApiObj.servers[0].url || "")
    : ""

  const result = []

  for (const [path, pathItem] of Object.entries(openApiObj.paths)) {
    if (!pathItem || typeof pathItem !== "object") continue

    // path-level parameters는 각 operation과 병합(operation 우선)
    const pathLevelParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : []

    for (const method of METHODS) {
      const op = pathItem[method]
      if (!op || typeof op !== "object") continue

      const opParams = Array.isArray(op.parameters) ? op.parameters : []
      // 중복 제거: in+name 키 기준, operation-level 우선
      const paramMap = new Map()
      for (const p of [...pathLevelParams, ...opParams]) {
        if (p && p.name) paramMap.set(`${p.in}:${p.name}`, p)
      }

      const { params, queryContent, headers } = parseParameters([...paramMap.values()])
      const { contentType, content } = deriveBodyInfo(method, op.requestBody, queryContent)

      result.push({
        name: deriveName(op, method, path),
        description: deriveDescription(op),
        method: method.toUpperCase(),
        contentType,
        content,
        headers,
        params,
        result: { type: "json", _error: "", _result: "" },
        url: baseUrl + toUrlTemplate(path),
        authType: "noAuth",
        authParams: {},
      })
    }
  }

  return result
}
