import { useState, useRef } from 'react'
import { openWorkbook } from './lib/parseExcelFile.js'
import { excelToUploadCsv } from './lib/excelToUploadCsv.js'
import { isReservedTimestampColumn, AUTO_APPEND_COLUMNS } from './lib/uploadCsvRules.js'
import { inferSchemaFields } from './lib/inferSchemaFields.js'
import { buildSchema } from './lib/buildSchema.js'
import { FIELD_TYPES, csvTypeOf } from './lib/schemaFieldRules.js'
import { applyFieldSelection } from './lib/applyFieldSelection.js'
import { toEnglishFieldName, applyEnglishNames } from './lib/toEnglishFieldName.js'
import { collectColumnSamples } from './lib/columnSamples.js'
import { cleanRows } from './lib/cleanRows.js'
import { detectNumberRisks } from './lib/numberRisk.js'
import { schemaNameWarning } from './lib/schemaValidation.js'
import StepBar from '../../components/shared/ui-kit/StepBar.jsx'
import Input from '../../components/shared/ui-kit/Input.jsx'
import Select from '../../components/shared/ui-kit/Select.jsx'
import Checkbox from '../../components/shared/ui-kit/Checkbox.jsx'
import UploadZone from '../../components/shared/ui-kit/UploadZone.jsx'
import AppHeader from '../../components/shared/AppHeader.jsx'

const STEP = { UPLOAD: 'upload', SHEET: 'sheet', TYPES: 'types', PREVIEW: 'preview' }
const MAX_PREVIEW_ROWS = 100
// 스키마 필드명 권장 최대 길이 — 넘으면 경고만(차단 아님).
const FIELD_NAME_MAX_LEN = 64

function stemFilename(name) {
  return name.replace(/\.[^/.]+$/, '')
}

function sanitizeFilename(name) {
  return name.replace(/[/\\?%*:|"<>]/g, '_')
}

// 표 안에서 보여줄 만큼만 자른다(전체 값은 title 속성으로 확인).
function ellipsize(text, max = 40) {
  const s = String(text ?? '')
  return s.length > max ? `${s.slice(0, max)}…` : s
}

// ── 공통 버튼 클래스 ──────────────────────────────────────────────────────────
// SmartHub 테마 토큰 기준(accent는 밝은 보라라서 글자는 bg-base로 — .modal-submit과 같은 규칙).
// ui-kit/Button을 쓰지 않는 자리(단계 진행/다운로드 버튼)의 표기를 한곳에서 맞춘다.
const BTN_PRIMARY =
  'px-4 py-2 rounded-lg bg-accent text-bg-base text-sm font-semibold transition-colors hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed'
const BTN_SECONDARY =
  'px-4 py-2 rounded-lg border border-border-subtle bg-bg-hover text-sm text-text-secondary transition-colors hover:text-text-primary hover:border-border-strong'
const BTN_OUTLINE_ACCENT =
  'px-4 py-2 rounded-lg border border-accent text-accent text-sm font-semibold transition-colors hover:bg-accent/12 disabled:opacity-40 disabled:cursor-not-allowed'

// ── Sheet select ─────────────────────────────────────────────────────────────

function SheetSelect({ sheets, selected, onSelect, onConfirm, onBack, loading }) {
  const hiddenCount = sheets.filter((s) => s.hidden).length
  return (
    <div className="bg-bg-surface border border-border-subtle rounded-xl p-6">
      <h2 className="text-base font-medium text-text-primary mb-1">시트 선택</h2>
      <p className="text-sm text-text-secondary mb-4">파일에 시트가 여러 개 있습니다. 변환할 시트를 선택하세요.</p>
      {hiddenCount > 0 && (
        <div className="mb-4 p-3 bg-status-warn/10 border border-status-warn/30 text-status-warn text-xs rounded-lg">
          숨겨진 시트 {hiddenCount}개가 포함되어 있습니다 — 의도한 시트인지 확인하세요(기본 선택은 보이는 시트).
        </div>
      )}
      <div className="flex flex-col gap-2 mb-6">
        {sheets.map((sheet) => (
          <label
            key={sheet.name}
            className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-border-subtle hover:border-accent transition-colors"
          >
            <input
              type="radio"
              name="sheet"
              value={sheet.name}
              checked={selected === sheet.name}
              onChange={() => onSelect(sheet.name)}
              className="accent-accent"
            />
            <span className="text-sm text-text-primary">{sheet.name}</span>
            {sheet.hidden && (
              <span className="text-[11px] bg-status-warn/20 text-status-warn px-1.5 py-0.5 rounded">숨김</span>
            )}
            <span className="text-xs text-text-faint">
              {sheet.rows}행 × {sheet.cols}열
            </span>
          </label>
        ))}
      </div>
      <div className="flex gap-3">
        <button onClick={onBack} className={BTN_SECONDARY}>
          처음으로
        </button>
        <button onClick={onConfirm} disabled={loading} className={BTN_PRIMARY}>
          {loading ? '읽는 중…' : '선택 완료'}
        </button>
      </div>
    </div>
  )
}

// ── Header row picker ────────────────────────────────────────────────────────

// 제목·작성자 행이 앞에 붙은 실무 문서는 1행이 헤더가 아니다. 자동 추정값을 보여주고
// 사용자가 직접 고를 수 있게 한다(고르면 그 행 기준으로 다시 파싱).
function HeaderRowPanel({ rawPreview, headerRow, onChange }) {
  if (!rawPreview || rawPreview.length <= 1) return null
  const label = (row) => {
    const text = (row || []).map((c) => String(c ?? '').trim()).filter(Boolean).join(' | ')
    return text.length > 90 ? `${text.slice(0, 90)}…` : text || '(빈 행)'
  }
  return (
    <div className="bg-bg-surface border border-border-subtle rounded-xl p-5 mb-4">
      <h2 className="text-base font-medium text-text-primary mb-1">헤더 행</h2>
      <p className="text-xs text-text-secondary mb-3">
        열 이름이 들어 있는 행입니다. 값이 가장 많이 채워진 행을 자동으로 골랐습니다
        {headerRow > 0 && <strong className="text-accent"> — 현재 {headerRow + 1}행</strong>}. 다르면 직접 고르세요(위쪽 행은 버립니다).
      </p>
      <Select
        value={String(headerRow)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="text-xs w-full max-w-2xl"
      >
        {rawPreview.map((row, i) => (
          <option key={i} value={String(i)}>
            {i + 1}행 — {label(row)}
          </option>
        ))}
      </Select>
    </div>
  )
}

// ── Field setting ────────────────────────────────────────────────────────────

function FieldSetting({
  allHeaders, editableHeaders, fieldSpecs, fieldErrors, selectionError, includedCount, convertNotice,
  samples, unnamedHeaders, keyCount, headerLabels, numberRisks, errorCells, fieldWarnings,
  onChangeType, onToggleKey, onToggleCrypt, onToggleInclude, onChangeOutputName, onConvertNames, onConfirm, onBack,
}) {
  const reservedInFile = allHeaders.filter((h) => isReservedTimestampColumn(h))
  // 파싱 단계에서 이름을 보정한 컬럼(중복·빈 헤더) — 원본과 다르면 알린다.
  const renamed = editableHeaders.filter((h) => (headerLabels?.[h] ?? h) !== h)

  return (
    <div className="bg-bg-surface border border-border-subtle rounded-xl p-6">
      <h2 className="text-base font-semibold text-text-primary mb-1">스키마 필드 설정</h2>
      <p className="text-sm text-text-secondary mb-4">
        사용할 컬럼을 고르고 스키마 필드명·속성을 확인하세요.
        숫자처럼 보이는 문자열(예: <code className="bg-bg-hover text-text-primary px-1 rounded">0101234</code>)은 string,
        레코드를 식별하는 컬럼은 <span className="whitespace-nowrap">🔑 키</span>,
        개인정보는 <span className="whitespace-nowrap">🔒 암호화</span>로 설정합니다.
        여기서 정한 내용이 CSV와 스키마 JSON 양쪽에 그대로 반영됩니다.
      </p>

      {reservedInFile.length > 0 && (
        <div className="mb-4 p-3 bg-status-warn/10 border border-status-warn/30 text-status-warn text-xs rounded-lg">
          파일의 <strong>{reservedInFile.join(', ')}</strong> 열은 스키마 형식에 따라 자동 처리됩니다(CSV·스키마 양쪽에서 제외, 값은 스키마가 채웁니다).
        </div>
      )}

      {renamed.length > 0 && (
        <div className="mb-4 p-3 bg-status-warn/10 border border-status-warn/30 text-status-warn text-xs rounded-lg">
          헤더가 겹치거나 비어 있어 컬럼 이름을 구분했습니다 —{' '}
          <strong>{renamed.map((h) => `${headerLabels[h] || '(빈 헤더)'} → ${h}`).join(', ')}</strong>.
          엑셀 원본 확인 후 스키마 필드명을 알맞게 고쳐 주세요.
        </div>
      )}

      {errorCells?.length > 0 && (
        <div className="mb-4 p-3 bg-status-warn/10 border border-status-warn/30 text-status-warn text-xs rounded-lg">
          엑셀 오류 값 {errorCells.length}개가 빈칸으로 처리됐습니다 —{' '}
          <strong>{errorCells.slice(0, 5).map((c) => `${c.ref}:${c.value}`).join(', ')}</strong>
          {errorCells.length > 5 && ' …'}
        </div>
      )}

      {editableHeaders.length === 0 ? (
        <p className="text-sm text-text-secondary mb-6">설정할 컬럼이 없습니다.</p>
      ) : (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2 gap-4">
            <p className="text-xs text-text-secondary">
              사용 <strong className="text-text-primary">{includedCount}</strong> / 전체 {editableHeaders.length}
              {' · '}🔑 키 <strong className="text-text-primary">{keyCount}</strong>
            </p>
            <button
              type="button"
              onClick={onConvertNames}
              className="px-3 py-1.5 border border-accent text-accent text-xs font-semibold rounded-lg transition-colors hover:bg-accent/12"
            >
              영문 이름 다시 추천
            </button>
          </div>

          {convertNotice && (
            <div className="mb-3 p-3 bg-accent/10 border border-accent/30 text-accent text-xs rounded-lg">
              {convertNotice}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border-strong">
                  <th className="pb-2 text-left font-semibold text-text-secondary pr-6">사용</th>
                  <th className="pb-2 text-left font-semibold text-text-secondary pr-6">원본 컬럼</th>
                  <th className="pb-2 text-left font-semibold text-text-secondary pr-6">샘플 데이터</th>
                  <th className="pb-2 text-left font-semibold text-text-secondary pr-6">스키마 필드명</th>
                  <th className="pb-2 text-left font-semibold text-text-secondary pr-6">타입</th>
                  <th className="pb-2 text-left font-semibold text-text-secondary pr-6">🔑 키</th>
                  <th className="pb-2 text-left font-semibold text-text-secondary">🔒 암호화</th>
                </tr>
              </thead>
              <tbody>
                {editableHeaders.map((header) => {
                  const spec = fieldSpecs[header] ?? { type: 'string', key: false, crypt: 'false', include: true, outputName: header }
                  const included = spec.include !== false
                  const err = fieldErrors[header]
                  return (
                    <tr
                      key={header}
                      className={`border-b border-border-subtle ${included ? 'hover:bg-bg-hover' : 'bg-bg-base opacity-50'}`}
                    >
                      <td className="py-3 pr-6">
                        <Checkbox
                          checked={included}
                          onChange={() => onToggleInclude(header)}
                        />
                      </td>
                      {/* 엑셀 헤더가 문장처럼 긴 경우(실제 150자 사례)에도 표가 무너지지 않게 잘라 보여준다(전체는 title). */}
                      <td className="py-3 pr-6 max-w-[200px] align-top">
                        <span title={header} className="block font-mono text-xs text-text-secondary break-all">
                          {ellipsize(header)}
                        </span>
                        {(headerLabels?.[header] ?? header) !== header && (
                          <span
                            title={headerLabels[header]}
                            className="block mt-0.5 text-[11px] text-status-warn break-all"
                          >
                            원본: {ellipsize(headerLabels[header]) || '(빈 헤더)'}
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-6 max-w-[220px]">
                        {(samples[header] ?? []).length === 0 ? (
                          <span className="text-xs text-text-faint">(값 없음)</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {samples[header].map((v, i) => (
                              <span key={i} className="text-[11px] bg-bg-hover text-text-secondary px-1.5 py-0.5 rounded font-mono">
                                {v}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3 pr-6">
                        <input
                          type="text"
                          value={spec.outputName ?? header}
                          disabled={!included}
                          onChange={(e) => onChangeOutputName(header, e.target.value)}
                          className={`border rounded-lg px-2 py-1 text-xs font-mono w-44 focus:outline-none focus:border-accent disabled:cursor-not-allowed ${
                            err
                              ? 'border-status-error bg-status-error/10 text-status-error'
                              : 'border-border-strong bg-bg-base text-text-primary'
                          }`}
                        />
                        {err && <p className="mt-1 text-[11px] text-status-error">{err}</p>}
                        {!err && included && fieldWarnings?.[header] && (
                          <p className="mt-1 text-[11px] text-status-warn">{fieldWarnings[header]}</p>
                        )}
                        {!err && included && unnamedHeaders.has(header) && (
                          <p className="mt-1 text-[11px] text-status-warn">자동 추천 실패 — 직접 입력하세요</p>
                        )}
                      </td>
                      <td className="py-3 pr-6">
                        <Select
                          value={spec.type}
                          disabled={!included}
                          onChange={(e) => onChangeType(header, e.target.value)}
                          className="text-xs py-1 w-auto min-w-[80px]"
                        >
                          {FIELD_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </Select>
                        {included && (numberRisks?.[header] ?? []).map((msg) => (
                          <p key={msg} className="mt-1 max-w-[200px] text-[11px] text-status-warn">{msg}</p>
                        ))}
                      </td>
                      <td className="py-3 pr-6">
                        <input
                          type="checkbox"
                          checked={spec.key}
                          disabled={!included}
                          onChange={() => onToggleKey(header)}
                          className="accent-accent w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="py-3">
                        <input
                          type="checkbox"
                          checked={spec.crypt === 'true'}
                          disabled={!included}
                          onChange={() => onToggleCrypt(header)}
                          className="accent-accent w-4 h-4 cursor-pointer disabled:cursor-not-allowed"
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-text-faint">
            체크를 해제한 컬럼은 CSV와 스키마 양쪽에서 제외됩니다. 🔑 키는 여러 개 지정할 수 있습니다(복합키).
            스키마 필드명은 샘플 데이터를 보고 자동 추천된 값이며, 그대로 쓰거나 고칠 수 있습니다.
          </p>
        </div>
      )}

      {selectionError && (
        <div className="mb-4 p-3 bg-status-error/10 border border-status-error/30 text-status-error text-xs rounded-lg">
          {selectionError}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={onBack} className={BTN_SECONDARY}>
          이전
        </button>
        <button onClick={onConfirm} disabled={!!selectionError} className={BTN_PRIMARY}>
          설정 완료 · 변환하기
        </button>
      </div>
    </div>
  )
}

// ── 스키마 schema panel ─────────────────────────────────────────────────────────

function SchemaPanel({ schemaName, onChangeName, schema, disabledReason, nameWarning, onDownload }) {
  const [open, setOpen] = useState(true)
  const [copied, setCopied] = useState(false)
  const text = JSON.stringify(schema, null, 2)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch (e) { console.error(e) }
      document.body.removeChild(ta)
    }
  }

  return (
    <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 mb-4">
      <div className="flex items-start justify-between mb-3 gap-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">스키마</h2>
          <p className="text-sm text-text-secondary">
            이 JSON을 대상 시스템에 먼저 등록한 뒤 CSV를 업로드하세요. ({schema.fields.length}개 필드)
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={copy} disabled={!!disabledReason} className={BTN_OUTLINE_ACCENT}>
            {copied ? '복사됨 ✓' : 'JSON 복사'}
          </button>
          <button
            onClick={onDownload}
            disabled={!!disabledReason}
            className={`${BTN_PRIMARY} whitespace-nowrap`}
          >
            ↓ 스키마 JSON 다운로드
          </button>
        </div>
      </div>

      <label className="block mb-3">
        <span className="block text-xs text-text-secondary mb-1">스키마명</span>
        <Input
          type="text"
          value={schemaName}
          onChange={(e) => onChangeName(e.target.value)}
          className="max-w-sm"
          placeholder="예: reservation"
        />
      </label>

      {disabledReason && (
        <div className="mb-3 p-3 bg-status-warn/10 border border-status-warn/30 text-status-warn text-xs rounded-lg">
          {disabledReason}
        </div>
      )}

      {!disabledReason && nameWarning && (
        <div className="mb-3 p-3 bg-status-warn/10 border border-status-warn/30 text-status-warn text-xs rounded-lg">
          {nameWarning}
        </div>
      )}

      <div className="flex flex-wrap gap-1 mb-3">
        {schema.fields.map((f) => (
          <span key={f.name} className="text-xs bg-bg-hover border border-border-subtle px-2 py-0.5 rounded text-text-secondary">
            {f.name}:{f.type}{f.key ? ' 🔑' : ''}{f.crypt === 'true' ? ' 🔒' : ''}
          </span>
        ))}
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-accent hover:text-accent-hover hover:underline"
      >
        {open ? 'JSON 접기' : 'JSON 펼치기'}
      </button>
      {open && (
        <pre className="mt-2 bg-bg-base border border-border-subtle text-text-secondary rounded-lg p-3 overflow-auto max-h-72 text-xs">{text}</pre>
      )}
    </div>
  )
}

// ── Preview ──────────────────────────────────────────────────────────────────

function Preview({ outputHeaders, rows, errorRowSet, errors, warnings = [], stats, onDownload, onBack, filename }) {
  const previewRows = rows.slice(0, MAX_PREVIEW_ROWS)
  const hasErrors = errors.length > 0
  const truncated = rows.length > MAX_PREVIEW_ROWS
  const errorCells = new Set(errors.map((e) => `${e.row} ${e.column}`))
  const warningCells = new Set(warnings.map((w) => `${w.row} ${w.column}`))
  // 같은 사유는 한 줄로 묶어 보여준다(12000행이면 같은 경고가 12000건이 되므로).
  const warningSummary = [...new Map(warnings.map((w) => [`${w.column}|${w.message}`, w])).values()]
  const cleaned = stats && (stats.removedEmpty > 0 || stats.trimmedCells > 0 || stats.normalizedCells > 0)

  return (
    <div>
      <div className="bg-bg-surface border border-border-subtle rounded-xl p-6 mb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-text-primary">변환 미리보기</h2>
            <p className="text-sm text-text-secondary">
              {rows.length}행 · {outputHeaders.length}열
              {truncated && ` (처음 ${MAX_PREVIEW_ROWS}행만 표시)`}
            </p>
          </div>
          <button onClick={onDownload} className={`${BTN_PRIMARY} whitespace-nowrap`}>
            ↓ CSV 다운로드
          </button>
        </div>

        <p className="mb-4 text-xs text-text-faint">파일명: {filename}</p>

        {cleaned && (
          <div className="mb-4 p-3 bg-accent/10 border border-accent/30 text-accent text-xs rounded-lg">
            데이터 정제: 빈 행 {stats.removedEmpty}개 제거 · 공백 정리 {stats.trimmedCells}셀 · 정규화 {stats.normalizedCells}셀
          </div>
        )}

        {hasErrors && (
          <div className="mb-4 p-3 bg-status-error/10 border border-status-error/30 text-status-error text-xs rounded-lg">
            검증 오류 {errors.length}건 — 규격에 안 맞는 값(빨간 셀)을 확인하세요.
          </div>
        )}

        {warningSummary.length > 0 && (
          <div className="mb-4 p-3 bg-status-warn/10 border border-status-warn/30 text-status-warn text-xs rounded-lg">
            <p className="mb-1 font-medium">타입 경고 {warnings.length}건 — 값은 그대로 두었습니다(노란 셀).</p>
            <ul className="list-disc pl-4">
              {warningSummary.slice(0, 6).map((w) => (
                <li key={`${w.column}|${w.message}`}>{w.column}: {w.message}</li>
              ))}
            </ul>
            {warningSummary.length > 6 && <p className="mt-1">… 외 {warningSummary.length - 6}종</p>}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-bg-raised border-b border-border-strong">
                {outputHeaders.map((h) => (
                  <th
                    key={h}
                    className={`px-3 py-2 text-left font-semibold whitespace-nowrap ${
                      isReservedTimestampColumn(h) ? 'text-text-faint' : 'text-text-secondary'
                    }`}
                  >
                    {h}
                    {isReservedTimestampColumn(h) && (
                      <span className="ml-1 font-normal text-text-faint">(자동)</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, ri) => {
                const hasError = errorRowSet.has(ri)
                return (
                  <tr
                    key={ri}
                    className={`border-b border-border-subtle ${
                      hasError ? 'bg-status-error/8' : 'hover:bg-bg-hover'
                    }`}
                  >
                    {outputHeaders.map((h) => {
                      const isReserved = isReservedTimestampColumn(h)
                      const cellError = errorCells.has(`${ri} ${h}`)
                      const cellWarning = !cellError && warningCells.has(`${ri} ${h}`)
                      return (
                        <td
                          key={h}
                          className={`px-3 py-2 ${
                            cellError
                              ? 'bg-status-error/20 text-status-error font-medium'
                              : cellWarning
                                ? 'bg-status-warn/10 text-status-warn'
                                : isReserved
                                  ? 'text-text-faint'
                                  : 'text-text-primary'
                          }`}
                        >
                          {isReserved ? '' : (row[h] ?? '')}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex gap-3">
        <button onClick={onBack} className={BTN_SECONDARY}>
          이전 (필드 재설정)
        </button>
        <button onClick={onDownload} className={BTN_PRIMARY}>
          ↓ CSV 다운로드
        </button>
      </div>
    </div>
  )
}

// 데이터 정제 옵션 패널 (③단계) — 트림·빈행제거는 자동, 정규화는 opt-in
function CleanOptionsPanel({ options, onChange }) {
  const items = [
    { key: 'normalizeNumbers', label: '숫자 포맷 정규화', hint: '1,000 · ₩5,000 → 1000 · 5000 (number 컬럼)' },
    { key: 'normalizeDates', label: '날짜 정규화', hint: '2026/1/5 · 20260105 → 2026-01-05' },
    { key: 'normalizeBooleans', label: '불린 정규화', hint: '예/아니오 · Y/N → true/false' },
  ]
  return (
    <div className="bg-bg-surface border border-border-subtle rounded-xl p-5 mb-4">
      <h2 className="text-base font-semibold text-text-primary mb-1">데이터 정제</h2>
      <p className="text-xs text-text-secondary mb-3">
        <span className="font-semibold text-accent">빈 행 제거 · 셀 공백 정리</span>는 자동 적용됩니다.
        아래 정규화는 원할 때만 켜세요(number 컬럼의 비-숫자 값은 미리보기에서 오류로 표시).
      </p>
      <div className="flex flex-col gap-2">
        {items.map((it) => (
          <label key={it.key} className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input
              type="checkbox"
              checked={!!options[it.key]}
              onChange={(e) => onChange(it.key, e.target.checked)}
              className="w-4 h-4 accent-accent"
            />
            <span className="font-semibold">{it.label}</span>
            <span className="text-xs text-text-faint">— {it.hint}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function ConvertPage() {
  const fileInputRef = useRef(null)
  // ⚠ 워크북은 파일당 한 번만 파싱해 재사용한다(시트 목록 조회 + 시트 파싱을 각각
  // 호출하면 대용량에서 파싱을 두 번 한다). 렌더에 쓰지 않으므로 ref.
  const workbookRef = useRef(null)
  const [file, setFile] = useState(null)
  const [step, setStep] = useState(STEP.UPLOAD)
  const [sheets, setSheets] = useState([])
  const [selectedSheet, setSelectedSheet] = useState('')
  const [sheetData, setSheetData] = useState(null)
  const [fieldSpecs, setFieldSpecs] = useState({})
  const [convResult, setConvResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [schemaName, setSchemaName] = useState('')
  const [schemaCreatedAt, setSchemaCreatedAt] = useState('')
  const [convertNotice, setConvertNotice] = useState('')
  const [projection, setProjection] = useState(null)
  const [cleanOptions, setCleanOptions] = useState({
    normalizeNumbers: false,
    normalizeDates: false,
    normalizeBooleans: false,
  })

  const reset = () => {
    setFile(null)
    setStep(STEP.UPLOAD)
    setSheets([])
    setSelectedSheet('')
    setSheetData(null)
    setFieldSpecs({})
    setConvResult(null)
    setError('')
    setSchemaName('')
    setSchemaCreatedAt('')
    setConvertNotice('')
    setProjection(null)
    workbookRef.current = null
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // headerRow: 숫자면 그 행, 'auto'면 값이 가장 많이 채워진 행을 헤더로 추정.
  const loadSheetData = (sheetName, headerRow = 'auto') => {
    const data = workbookRef.current.parseSheet(sheetName, { headerRow })
    setSheetData(data)
    const inferred = inferSchemaFields(data)
    // 스키마 필드명은 처음부터 영문 추천값으로 채운다. 변환하지 못한 이름은 원본을 유지하고,
    // 표에서 '자동 추천 실패'로 드러난다(파생 계산 — 사용자가 고치면 자동으로 사라진다).
    setFieldSpecs(Object.fromEntries(
      Object.entries(inferred).map(([name, spec]) => [
        name,
        { ...spec, include: true, outputName: toEnglishFieldName(name).name },
      ]),
    ))
    setConvertNotice('')
  }

  const handleFile = async (f) => {
    setFile(f)
    setError('')
    setLoading(true)
    try {
      const wb = openWorkbook(await f.arrayBuffer())
      workbookRef.current = wb
      setSheets(wb.sheets)
      if (wb.sheets.length <= 1) {
        const sheetName = wb.sheets[0]?.name ?? 'Sheet1'
        setSelectedSheet(sheetName)
        loadSheetData(sheetName)
        setStep(STEP.TYPES)
      } else {
        // 숨겨진 시트를 기본값으로 잡지 않는다 — 보이는 첫 시트를 고른다.
        const visible = wb.sheets.find((s) => !s.hidden) ?? wb.sheets[0]
        setSelectedSheet(visible.name)
        setStep(STEP.SHEET)
      }
    } catch (err) {
      setError(`파일 읽기 실패: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleSheetConfirm = () => {
    setError('')
    setLoading(true)
    try {
      loadSheetData(selectedSheet)
      setStep(STEP.TYPES)
    } catch (err) {
      setError(`시트 읽기 실패: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  // 헤더 행을 바꾸면 그 행 기준으로 다시 파싱한다(워크북은 이미 메모리에 있어 재읽기 없음).
  const changeHeaderRow = (rowIndex) => {
    setError('')
    try {
      loadSheetData(selectedSheet, rowIndex)
    } catch (err) {
      setError(`헤더 행 변경 실패: ${err.message}`)
    }
  }

  const changeType = (header, type) => {
    setFieldSpecs((prev) => ({ ...prev, [header]: { ...prev[header], type } }))
  }

  // 스키마는 복합키를 허용한다 — 컬럼별 독립 토글(개수 제한 없음).
  const toggleKey = (header) => {
    setFieldSpecs((prev) => ({
      ...prev,
      [header]: { ...prev[header], key: prev[header]?.key !== true },
    }))
  }

  const toggleCrypt = (header) => {
    setFieldSpecs((prev) => ({
      ...prev,
      [header]: { ...prev[header], crypt: prev[header]?.crypt === 'true' ? 'false' : 'true' },
    }))
  }

  const toggleInclude = (header) => {
    setFieldSpecs((prev) => ({
      ...prev,
      [header]: { ...prev[header], include: prev[header]?.include === false },
    }))
  }

  const changeOutputName = (header, outputName) => {
    setFieldSpecs((prev) => ({ ...prev, [header]: { ...prev[header], outputName } }))
  }

  // 사용 중인 컬럼만 일괄 영문 변환. 변환하지 못한 컬럼은 원본을 그대로 두고 이름을 알린다.
  // ⚠ 변환은 순수 함수(applyEnglishNames)로 미리 계산한다 — setState 업데이터 안에서
  // 실패를 세면 그 값을 업데이터 밖에서 읽을 수 없다(항상 0으로 읽혀 오안내가 났다).
  const convertNamesToEnglish = () => {
    const { fieldSpecs: converted, failed } = applyEnglishNames(fieldSpecs)
    setFieldSpecs(converted)
    setConvertNotice(failed.length > 0
      ? `${failed.length}개 컬럼은 자동 변환하지 못했습니다 — ${failed.join(', ')} 은(는) 직접 입력해 주세요.`
      : '사용 중인 컬럼을 모두 영문으로 변환했습니다.')
  }

  const handleTypesConfirm = () => {
    // ⚠ 예약 타임스탬프 열은 투영 단계에서 뺀다 — CSV·스키마는 원래 제외하는데
    // 투영에 남겨두면 미리보기 열 수가 실제 CSV와 달라지고 createdAt이 두 번 보인다.
    const projected = applyFieldSelection(
      { headers: editableHeaders, rows: sheetData.rows },
      fieldSpecs,
    )
    const columnTypes = Object.fromEntries(
      Object.entries(projected.fieldSpecs).map(([name, spec]) => [name, csvTypeOf(spec.type)]),
    )
    const fieldTypes = Object.fromEntries(
      Object.entries(projected.fieldSpecs).map(([name, spec]) => [name, spec.type]),
    )
    setProjection(projected)
    // 정제: 트림·빈행 제거(항상) + 검증·경고 + 정규화(opt-in) → 정제된 rows로 CSV·미리보기
    const cleaned = cleanRows(
      { headers: projected.headers, rows: projected.rows, columnTypes, fieldTypes },
      cleanOptions,
    )
    const conv = excelToUploadCsv({ headers: projected.headers, rows: cleaned.rows, columnTypes })
    setConvResult({
      csv: conv.csv,
      rows: cleaned.rows,
      errors: cleaned.errors,
      warnings: cleaned.warnings,
      stats: cleaned.stats,
    })
    // 스키마명 기본값 — 다중 시트면 시트명, 아니면 파일명 stem
    setSchemaName((prev) => prev || sanitizeFilename(
      sheets.length > 1 ? selectedSheet : stemFilename(file?.name ?? ''),
    ))
    setSchemaCreatedAt(new Date().toISOString())
    setStep(STEP.PREVIEW)
  }

  const handleDownload = () => {
    const stem = sanitizeFilename(stemFilename(file.name))
    const filename = `schema-${stem}.csv`
    const blob = new Blob([convResult.csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleSchemaDownload = () => {
    const blob = new Blob([JSON.stringify(schemaDoc, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${sanitizeFilename(schemaName)}_schema.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasMultiSheet = sheets.length > 1
  const stepBarSteps = hasMultiSheet
    ? ['시트 선택', '스키마 필드 설정', '미리보기 · 다운로드']
    : ['스키마 필드 설정', '미리보기 · 다운로드']
  const stepBarIndex = hasMultiSheet
    ? ({ [STEP.SHEET]: 0, [STEP.TYPES]: 1, [STEP.PREVIEW]: 2 }[step] ?? 0)
    : ({ [STEP.TYPES]: 0, [STEP.PREVIEW]: 1 }[step] ?? 0)
  const editableHeaders = sheetData?.headers?.filter((h) => !isReservedTimestampColumn(h)) ?? []
  const errorRowSet = new Set(convResult?.errors?.map((e) => e.row) ?? [])
  const downloadFilename = file
    ? `schema-${sanitizeFilename(stemFilename(file.name))}.csv`
    : ''

  const samples = collectColumnSamples(sheetData ?? { headers: [], rows: [] })
  // 파싱 단계에서 보정된 헤더 키 → 원본 문자열(중복·빈 헤더를 사용자에게 설명하기 위함)
  const headerLabels = Object.fromEntries(
    (sheetData?.headers ?? []).map((h, i) => [h, (sheetData?.headerSources?.[i] ?? h).trim()]),
  )
  // number 타입이 값을 망가뜨릴 위험(선행 0·정밀도) — 경고만, 자동 변경 없음
  const numberRisks = detectNumberRisks(sheetData ?? { headers: [], rows: [] }, fieldSpecs)
  // 자동 추천이 실패한 채로 남아 있는 컬럼(= 이름이 아직 원본 그대로). 사용자가 고치면 빠진다.
  const unnamedHeaders = new Set(
    editableHeaders.filter(
      (h) => !toEnglishFieldName(h).converted && (fieldSpecs[h]?.outputName ?? h) === h,
    ),
  )

  // ③단계 검증 — 사용 중인 컬럼의 이름만 대상(제외 컬럼은 검사하지 않는다).
  const includedHeaders = editableHeaders.filter((h) => fieldSpecs[h]?.include !== false)
  const keyCount = includedHeaders.filter((h) => fieldSpecs[h]?.key === true).length
  const nameCounts = includedHeaders.reduce((acc, h) => {
    const n = (fieldSpecs[h]?.outputName ?? h).trim()
    acc[n] = (acc[n] || 0) + 1
    return acc
  }, {})
  const fieldErrors = Object.fromEntries(
    includedHeaders
      .map((h) => {
        const n = (fieldSpecs[h]?.outputName ?? h).trim()
        if (n === '') return [h, '이름을 입력하세요.']
        if (nameCounts[n] > 1) return [h, '이름이 중복됩니다.']
        if (isReservedTimestampColumn(n)) return [h, '스키마 예약 열 이름은 쓸 수 없습니다.']
        return [h, '']
      })
      .filter(([, msg]) => msg !== ''),
  )
  // 차단은 아니지만 스키마 등록에서 문제되기 쉬운 필드명(너무 긴 이름 — 엑셀 헤더가 문장인 경우)
  const fieldWarnings = Object.fromEntries(
    includedHeaders
      .map((h) => {
        const n = (fieldSpecs[h]?.outputName ?? h).trim()
        return [h, n.length > FIELD_NAME_MAX_LEN ? `이름이 너무 깁니다(${n.length}자) — ${FIELD_NAME_MAX_LEN}자 이내를 권장합니다.` : '']
      })
      .filter(([, msg]) => msg !== ''),
  )
  const selectionError =
    editableHeaders.length === 0
      ? ''
      : includedHeaders.length === 0
        ? '사용할 컬럼을 최소 한 개 선택하세요.'
        : Object.keys(fieldErrors).length > 0
          ? '필드명 오류를 수정한 뒤 진행할 수 있습니다.'
          : ''

  const schemaDoc = buildSchema({
    schemaName,
    headers: projection?.headers ?? [],
    fieldSpecs: projection?.fieldSpecs ?? {},
    createdAt: schemaCreatedAt,
  })
  const previewHeaders = [...(projection?.headers ?? []), ...AUTO_APPEND_COLUMNS]
  const previewRows = convResult?.rows ?? projection?.rows ?? []
  const schemaNameNotice = schemaNameWarning(schemaName)
  const schemaDisabledReason =
    schemaDoc.fields.length === 0
      ? '스키마 필드가 없습니다 — 모든 컬럼이 스키마 자동 관리 열(createdAt/updatedAt)입니다.'
      : schemaName.trim() === ''
        ? '스키마명을 입력하세요.'
        : ''

  return (
    <div className="app">
      <AppHeader toolName="엑셀 → 스키마 변환" />

      <div className="doc-wrap">
      <p className="doc-desc">
        엑셀 파일(.xlsx / .xls / .csv)을 스키마 업로드용 CSV와 스키마 생성용 JSON으로 변환합니다.
      </p>

      {step !== STEP.UPLOAD && (
        <StepBar steps={stepBarSteps} currentIndex={stepBarIndex} />
      )}

      {error && (
        <div className="mb-4 p-3 bg-status-error/10 border border-status-error/30 text-status-error text-sm rounded-lg">
          {error}
        </div>
      )}

      {step === STEP.UPLOAD && (
        <UploadZone onFile={handleFile} accept=".xlsx,.xls,.csv" hint=".xlsx · .xls · .csv" loading={loading} />
      )}

      {step === STEP.SHEET && (
        <SheetSelect
          sheets={sheets}
          selected={selectedSheet}
          onSelect={setSelectedSheet}
          onConfirm={handleSheetConfirm}
          onBack={reset}
          loading={loading}
        />
      )}

      {step === STEP.TYPES && sheetData && (
        <>
        <HeaderRowPanel
          rawPreview={sheetData.rawPreview}
          headerRow={sheetData.headerRow}
          onChange={changeHeaderRow}
        />
        <CleanOptionsPanel
          options={cleanOptions}
          onChange={(k, v) => setCleanOptions((p) => ({ ...p, [k]: v }))}
        />
        <FieldSetting
          allHeaders={sheetData.headers}
          editableHeaders={editableHeaders}
          fieldSpecs={fieldSpecs}
          fieldErrors={fieldErrors}
          fieldWarnings={fieldWarnings}
          selectionError={selectionError}
          includedCount={includedHeaders.length}
          convertNotice={convertNotice}
          samples={samples}
          unnamedHeaders={unnamedHeaders}
          keyCount={keyCount}
          headerLabels={headerLabels}
          numberRisks={numberRisks}
          errorCells={sheetData.errorCells}
          onChangeType={changeType}
          onToggleKey={toggleKey}
          onToggleCrypt={toggleCrypt}
          onToggleInclude={toggleInclude}
          onChangeOutputName={changeOutputName}
          onConvertNames={convertNamesToEnglish}
          onConfirm={handleTypesConfirm}
          onBack={() => (hasMultiSheet ? setStep(STEP.SHEET) : reset())}
        />
        </>
      )}

      {step === STEP.PREVIEW && sheetData && convResult && projection && (
        <>
          <SchemaPanel
            schemaName={schemaName}
            onChangeName={setSchemaName}
            schema={schemaDoc}
            disabledReason={schemaDisabledReason}
            nameWarning={schemaNameNotice}
            onDownload={handleSchemaDownload}
          />
          <Preview
            outputHeaders={previewHeaders}
            rows={previewRows}
            errorRowSet={errorRowSet}
            errors={convResult.errors}
            warnings={convResult.warnings}
            stats={convResult.stats}
            onDownload={handleDownload}
            onBack={() => setStep(STEP.TYPES)}
            filename={downloadFilename}
          />
        </>
      )}
      </div>
    </div>
  )
}
