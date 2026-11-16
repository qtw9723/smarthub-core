// 엑셀 파싱 어댑터 (브라우저 File/ArrayBuffer → 정규화 { headers, rows }).
// 파싱 라이브러리(xlsx)는 이 파일에만 격리한다.
import * as XLSX from 'xlsx'
import { normalizeSheetData } from './normalizeSheet.js'

/**
 * ArrayBuffer를 워크북으로 읽는다.
 * ⚠ CSV/텍스트는 SheetJS가 기본 cp1252로 오독해 UTF-8 한글이 깨진다.
 * 바이너리(xlsx=PK, xls=OLE)만 array로 읽고, 그 외(CSV 등 텍스트)는
 * UTF-8로 디코딩(BOM 제거)해 string으로 넘겨 인코딩 손실을 막는다.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {import('xlsx').WorkBook}
 */
function readWorkbook(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer)
  const isBinary =
    (bytes[0] === 0x50 && bytes[1] === 0x4b) || // 'PK' — xlsx(zip)
    (bytes[0] === 0xd0 && bytes[1] === 0xcf) // OLE — 구형 xls
  if (isBinary) {
    return XLSX.read(bytes, { type: 'array' })
  }
  let text = new TextDecoder('utf-8').decode(bytes)
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1) // UTF-8 BOM 제거
  return XLSX.read(text, { type: 'string' })
}

/** 시트 메타(숨김 여부·크기)를 뽑는다. Hidden: 1=숨김, 2=매우 숨김(veryHidden) */
function sheetMeta(workbook, name) {
  const entry = (workbook.Workbook?.Sheets ?? []).find((s) => s?.name === name)
  const ws = workbook.Sheets[name]
  let rows = 0
  let cols = 0
  if (ws && ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref'])
    rows = range.e.r - range.s.r + 1
    cols = range.e.c - range.s.c + 1
  }
  return { name, hidden: (entry?.Hidden ?? 0) > 0, rows, cols }
}

/** 시트에서 엑셀 오류 값(#N/A·#REF! 등) 셀을 모은다 — sheet_to_json이 빈칸으로 삼켜버리므로 미리 알린다. */
function collectErrorCells(worksheet, limit = 20) {
  const found = []
  if (!worksheet) return found
  for (const ref of Object.keys(worksheet)) {
    if (ref.startsWith('!')) continue
    const cell = worksheet[ref]
    if (cell?.t === 'e') {
      if (found.length < limit) found.push({ ref, value: cell.w ?? '#ERROR' })
      else break
    }
  }
  return found
}

/**
 * 워크북을 한 번만 읽어 재사용하는 핸들을 만든다.
 * ⚠ 시트 목록 조회 + 시트 파싱을 각각 호출하면 워크북을 두 번 파싱한다(대용량에서 그대로 2배).
 * @param {ArrayBuffer} arrayBuffer
 * @returns {{
 *   sheetNames: string[],
 *   sheets: Array<{name: string, hidden: boolean, rows: number, cols: number}>,
 *   parseSheet: (sheetName: string, options?: {headerRow?: number|'auto'}) => object,
 * }}
 */
export function openWorkbook(arrayBuffer) {
  const workbook = readWorkbook(arrayBuffer)
  return {
    sheetNames: workbook.SheetNames,
    sheets: workbook.SheetNames.map((name) => sheetMeta(workbook, name)),
    parseSheet: (sheetName, options) => parseWorkbookSheet(workbook, sheetName, options),
  }
}

/** 워크북 + 시트명 → 정규화 결과. openWorkbook.parseSheet의 구현. */
function parseWorkbookSheet(workbook, sheetName, options = {}) {
  const worksheet = workbook.Sheets[sheetName]
  // raw:false → 셀 값을 서식 적용 문자열로 반환(숫자·날짜 포함)
  const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false })
  const normalized = normalizeSheetData(rawData, options)
  return {
    ...normalized,
    // 헤더 행 선택 UI용 원본 앞부분(정규화 전 그대로)
    rawPreview: rawData.slice(0, 8).map((row) => (Array.isArray(row) ? row.map((c) => String(c ?? '')) : [])),
    rawRowCount: rawData.length,
    errorCells: collectErrorCells(worksheet),
  }
}

/**
 * ArrayBuffer에서 시트명 목록을 반환한다.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {string[]}
 */
export function getSheetNames(arrayBuffer) {
  return readWorkbook(arrayBuffer).SheetNames
}

/**
 * ArrayBuffer의 특정 시트를 파싱해 정규화된 결과를 반환한다.
 * @param {ArrayBuffer} arrayBuffer
 * @param {string} sheetName workbook.SheetNames 중 하나
 * @param {{ headerRow?: number|'auto' }} [options]
 * @returns {{ headers: string[], rows: Array<Record<string, string>>, headerSources: string[], headerRow: number, rawPreview: string[][], rawRowCount: number, errorCells: Array<{ref: string, value: string}> }}
 */
export function parseSheet(arrayBuffer, sheetName, options) {
  return parseWorkbookSheet(readWorkbook(arrayBuffer), sheetName, options)
}

/**
 * File 객체에서 시트명 목록을 반환한다 (브라우저 전용).
 * @param {File} file
 * @returns {Promise<string[]>}
 */
export async function getFileSheetNames(file) {
  const arrayBuffer = await file.arrayBuffer()
  return getSheetNames(arrayBuffer)
}

/**
 * File 객체의 특정 시트를 파싱해 정규화된 결과를 반환한다 (브라우저 전용).
 * @param {File} file
 * @param {string} sheetName
 * @param {{ headerRow?: number|'auto' }} [options]
 */
export async function parseFileSheet(file, sheetName, options) {
  const arrayBuffer = await file.arrayBuffer()
  return parseSheet(arrayBuffer, sheetName, options)
}
