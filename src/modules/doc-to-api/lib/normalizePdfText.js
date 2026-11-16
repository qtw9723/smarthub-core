export function normalizePdfText(input) {
  if (input == null) return ""
  if (typeof input === "string") return normalizeText(input)
  if (!Array.isArray(input) || input.length === 0) return ""
  return normalizeText(buildRaw(input))
}

function buildRaw(items) {
  const parts = []
  let line = ""
  for (const item of items) {
    if (!item || typeof item.str !== "string") continue
    line += item.str
    if (item.hasEOL) {
      parts.push(line)
      line = ""
    }
  }
  if (line.trim()) parts.push(line)
  return parts.join("\n")
}

function normalizeText(raw) {
  if (typeof raw !== "string") return ""
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join("\n")
    .trim()
}
