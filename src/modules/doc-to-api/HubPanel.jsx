import { useState } from 'react'
import AppHeader from '../../components/shared/AppHeader.jsx'
import { Panel } from '../../components/shared/ui-kit/Card.jsx'
import Button from '../../components/shared/ui-kit/Button.jsx'
import StepBar from '../../components/shared/ui-kit/StepBar.jsx'
import UploadZone from '../../components/shared/ui-kit/UploadZone.jsx'
import { parseApiDoc } from '../../lib/api/docToApi.js'
import { getCookie } from '../../lib/auth.js'
import { extractFileText } from './lib/extractFileText.js'
import { extractApiDefsFromFile } from './lib/extractApiDefsFromFile.js'
import { extractApiDefsFromText } from './lib/extractApiDefs.js'
import { blankDef, KvEditor, ParamEditor, ApiDefCard } from './apiDefEditor.jsx'
import { copyText } from '../../lib/clipboard.js'

// 부가 도구: 문서 → API 생성.
// 스키마 변환과 동일한 흐름 — ① 문서 입력(업로드/붙여넣기) → ② 추출된 API들을 검토·수정 → JSON 파일 저장.
// 문서에 여러 API가 있으면 여러 개를 만든다. 다형식(OpenAPI JSON/YAML·엑셀·PDF·텍스트) 입력을 받는다.
//   OpenAPI 3.x → 결정론 파서(parseApiDocToDefs), 그 외 자유형식 → LLM 엣지함수(api-doc-parse).

const STEPS = ['문서 입력', 'API 검토 · 수정 · 저장']

export default function HubPanel({ hubKey }) {
  const [step, setStep] = useState('input') // 'input' | 'review'
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState('')
  const [defs, setDefs] = useState([])
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [apiDocSource, setApiDocSource] = useState(null)

  const goReview = (list) => { setDefs(list); setCopied(false); setStep('review') }

  // 붙여넣기도 파일 업로드와 **같은 경로**를 쓴다(extractApiDefsFromText).
  // 예전에는 여기서 따로 파싱해서, 같은 문서라도 붙여넣으면 추출 방식 배지가 뜨지 않았다.
  const generate = async () => {
    setError(''); setApiDocSource(null); setGenerating(true)
    try {
      const { defs: got, source, error: extractError } = await extractApiDefsFromText(raw, {
        callApiDocParse: (text) => parseApiDoc(text, getCookie(), hubKey),
      })
      if (extractError || !got.length) {
        setError(extractError || '문서에서 API를 추출하지 못했습니다. 내용을 확인하거나 더 구체적으로 작성해보세요.')
        return
      }
      setApiDocSource(source)
      goReview(got)
    } catch (e) {
      setError(e?.message || '생성 중 오류가 발생했습니다.')
    } finally {
      setGenerating(false)
    }
  }

  const onFile = async (f) => {
    setError(''); setFileName(f.name); setExtracting(true); setApiDocSource(null)
    const callApiDocParse = (text) => parseApiDoc(text, getCookie(), hubKey)
    try {
      const { defs, source, error: extractError } = await extractApiDefsFromFile(f, { extractText: extractFileText, callApiDocParse })
      if (extractError || !defs.length) {
        setError(extractError || '파일에서 API를 추출하지 못했습니다.')
        setFileName('')
        return
      }
      setApiDocSource(source)
      goReview(defs)
    } catch (e) {
      setError(e?.message || '파일에서 API를 추출하지 못했습니다.')
      setFileName('')
    } finally {
      setExtracting(false)
    }
  }

  const patchAt = (i) => (next) => setDefs(defs.map((d, idx) => (idx === i ? next : d)))
  const removeAt = (i) => setDefs(defs.filter((_, idx) => idx !== i))
  const addDef = () => setDefs([...defs, blankDef()])

  const json = defs.length ? JSON.stringify(defs, null, 2) : ''

  const copyJson = async () => {
    try {
      await copyText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('클립보드 복사에 실패했습니다. 아래 JSON을 직접 선택해 복사하세요.')
    }
  }

  const download = () => {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'api_def.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app">
      <AppHeader toolName="문서 → API 생성" />

      <div className="doc-wrap">
      <p className="doc-desc">
        API 문서를 올리면 그 안의 API들을 추출합니다. 검토·수정한 뒤 api_def JSON 파일로 저장하세요.
      </p>

      <StepBar steps={STEPS} currentIndex={step === 'input' ? 0 : 1} />

      {step === 'input' && (
        <Panel className="space-y-3">
          <label className="block text-sm font-semibold text-text-primary">API 문서</label>

          <UploadZone
            onFile={onFile}
            accept=".docx,.json,.yaml,.yml,.txt,.md,.csv,.xlsx,.xls,.pdf"
            hint="OpenAPI(JSON/YAML) · 워드 · 엑셀 · PDF · 텍스트"
            loading={extracting}
          />
          {fileName && !extracting && (
            <p className="text-xs text-text-secondary">불러온 파일: <span className="font-semibold text-text-primary">{fileName}</span></p>
          )}

          <div className="py-1 text-center">
            <span className="text-xs text-text-faint">또는 직접 붙여넣기</span>
          </div>

          <textarea
            value={raw}
            onChange={(e) => { setRaw(e.target.value); setFileName('') }}
            rows={12}
            placeholder={'OpenAPI 문서를 붙여넣거나, API가 설명된 문서(엑셀·PDF·텍스트)를 위에서 업로드하세요.'}
            className="w-full rounded-lg border border-border-strong bg-bg-base px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-faint focus:outline-none focus:border-accent"
          />
          <div className="flex justify-end">
            <Button onClick={generate} disabled={!raw.trim() || extracting || generating} loading={generating}>
              {generating ? '추출 중…' : 'API 추출'}
            </Button>
          </div>
          {error && <p className="text-sm text-status-error">{error}</p>}
        </Panel>
      )}

      {step === 'review' && (
        <Panel className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-text-primary">
              추출된 API {defs.length}개 — 확인하고 수정하세요
              {apiDocSource && (
                <span className="ml-2 rounded bg-accent/12 px-1.5 py-0.5 text-xs font-normal text-accent">
                  {apiDocSource === 'openapi' ? 'OpenAPI 결정론' : '문서(LLM)'}
                </span>
              )}
            </p>
            <Button variant="secondary" onClick={addDef}>+ API 추가</Button>
          </div>

          {defs.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-secondary">API가 없습니다. "+ API 추가"로 직접 만들거나 다시 입력하세요.</p>
          ) : (
            <div className="space-y-3">
              {defs.map((d, i) => (
                <ApiDefCard key={i} def={d} index={i} onChange={patchAt(i)} onRemove={() => removeAt(i)} />
              ))}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-semibold text-text-secondary">미리보기 — api_def JSON</label>
            <textarea
              readOnly
              value={json}
              rows={10}
              className="w-full rounded-lg border border-border-subtle bg-bg-base px-3 py-2 font-mono text-xs text-text-secondary"
            />
          </div>

          {error && <p className="text-sm text-status-error">{error}</p>}

          <div className="flex items-center justify-between pt-1">
            <Button variant="secondary" onClick={() => { setStep('input'); setError(''); setApiDocSource(null) }}>← 다시 입력</Button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={copyJson} disabled={!defs.length}>
                {copied ? '복사됨 ✓' : 'JSON 복사'}
              </Button>
              <Button onClick={download} disabled={!defs.length}>
                JSON 파일로 저장
              </Button>
            </div>
          </div>
        </Panel>
      )}
      </div>
    </div>
  )
}
