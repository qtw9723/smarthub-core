import { serializeWorkbook } from './serializeWorkbook.js'
import { normalizePdfText } from './normalizePdfText.js'
import { tablesFromHtml, textOutsideTables } from './docxTables.js'
import { unsupportedFormatMessage } from './unsupportedFormat.js'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export async function extractFileText(file) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''

  if (ext === 'txt' || ext === 'md' || ext === 'json' || ext === 'yaml' || ext === 'yml') {
    const text = await file.text()
    if (!text.trim()) throw new Error('파일이 비어 있습니다.')
    return text
  }

  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
    const XLSX = await import('xlsx')
    // CSV는 텍스트 — file.text()가 UTF-8로 디코딩(SheetJS의 cp1252 오독으로 한글 깨짐 방지).
    // 바이너리(xlsx/xls)만 arrayBuffer로 읽는다.
    const wb =
      ext === 'csv'
        ? XLSX.read(await file.text(), { type: 'string' })
        : XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheets = wb.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1 }),
    }))
    const text = serializeWorkbook(sheets)
    if (!text.trim()) throw new Error('Excel 파일에서 텍스트를 추출하지 못했습니다.')
    return text
  }

  if (ext === 'docx') {
    // mammoth는 브라우저 빌드를 쓴다. xlsx·pdfjs와 같이 동적 import로 지연 로드.
    const mammoth = await import('mammoth/mammoth.browser.js')
    const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
    // ⚠ extractRawText가 아니라 convertToHtml을 쓴다 — 표를 보존해야 한다.
    //    시나리오 정의서는 표가 본체이고, 열 구조가 무너지면 용어 매핑 자체가 성립하지 않는다.
    const tables = tablesFromHtml(html)
    const prose = textOutsideTables(html)
    // 표는 엑셀과 동일한 탭 구분 형식으로 직렬화한다 → 추출 프롬프트 무변경.
    const tableText = serializeWorkbook(tables)
    const text = [prose, tableText].filter((part) => part.trim() !== '').join('\n\n')
    if (!text.trim()) throw new Error('워드 문서에서 텍스트를 추출하지 못했습니다.')
    return text
  }

  if (ext === 'pdf') {
    const pdfjsLib = await import('pdfjs-dist')
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    const buffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
    const items = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      for (const item of content.items) {
        if ('str' in item) {
          items.push({ str: item.str, hasEOL: item.hasEOL })
        }
      }
    }
    const text = normalizePdfText(items)
    if (!text.trim()) throw new Error('PDF에서 텍스트를 추출하지 못했습니다. 텍스트 레이어가 없는 이미지 PDF일 수 있습니다.')
    return text
  }

  throw new Error(unsupportedFormatMessage(ext))
}
