import type { ToolResultOutput } from '../lib/chat-events'
import type { ToolCallState } from '../hooks/useChatStream'

type FormattedToolOutputProps = {
  name: string
  state: ToolCallState
  output?: ToolResultOutput
}

export function FormattedToolOutput({ name, state, output }: FormattedToolOutputProps) {
  if (state === 'complete-error') {
    return <UpstreamErrorBranch output={output} />
  }

  const value = output?.type === 'json' ? output.value : undefined

  if (name === 'symptom_lookup' && isEmptyResult(value)) {
    return <EmptyResultBranch />
  }

  if (name === 'drug_info' && isDrugNotFound(value)) {
    return <DrugNotFoundBranch />
  }

  // Slice 12 ships these as design-pinned sample copy. Slice 13/15 wires the
  // real output JSON through and replaces these branches with generic rendering.
  if (name === 'drug_info') return <DrugInfoSampleDeflist />
  if (name === 'symptom_lookup') return <SymptomLookupSampleDeflist />

  return null
}

// ── Branches ─────────────────────────────────────────────────────────────────

function UpstreamErrorBranch({ output }: { output?: ToolResultOutput }) {
  const message =
    output?.type === 'error-text'
      ? output.value
      : '503 Service Unavailable'
  return (
    <div className="rx-tool__error">
      <span className="t-body-sm" style={{ color: 'var(--tool-warn-fg)' }}>
        Upstream service returned <code className="t-code-i">{message}</code>. The assistant will continue with the information it already has.
      </span>
    </div>
  )
}

function EmptyResultBranch() {
  return (
    <div className="rx-tool__error">
      <span className="t-body-sm" style={{ color: 'var(--text-secondary)' }}>
        No matching symptom in the lookup database. The assistant will rely on general knowledge instead.
      </span>
    </div>
  )
}

function DrugNotFoundBranch() {
  return (
    <div className="rx-tool__error">
      <span className="t-body-sm" style={{ color: 'var(--text-secondary)' }}>
        The drug name was not found in the registry. Check the spelling, or try the generic name.
      </span>
    </div>
  )
}

function DrugInfoSampleDeflist() {
  return (
    <dl className="rx-deflist">
      <div>
        <dt className="t-label">Name</dt>
        <dd className="t-body-sm">
          Lisinopril <span style={{ color: 'var(--text-secondary)' }}>· ACE inhibitor</span>
        </dd>
      </div>
      <div>
        <dt className="t-label">Indications</dt>
        <dd className="t-body-sm">Hypertension, heart failure, post-myocardial infarction.</dd>
      </div>
      <div>
        <dt className="t-label">Adult dosage</dt>
        <dd className="t-body-sm">10–40 mg orally, once daily. Initial 10 mg; titrate to response.</dd>
      </div>
      <div>
        <dt className="t-label">Key warnings</dt>
        <dd className="t-body-sm">
          Angioedema (rare, more common in Black patients). Contraindicated in pregnancy. Risk of hyperkalemia with potassium-sparing diuretics.
        </dd>
      </div>
    </dl>
  )
}

function SymptomLookupSampleDeflist() {
  return (
    <dl className="rx-deflist">
      <div>
        <dt className="t-label">Description</dt>
        <dd className="t-body-sm">
          A persistent dry cough with no productive component, typically triggered by airway irritation.
        </dd>
      </div>
      <div>
        <dt className="t-label">Common causes</dt>
        <dd className="t-body-sm">
          Postnasal drip, gastroesophageal reflux, ACE inhibitor medication, viral aftermath.
        </dd>
      </div>
      <div>
        <dt className="t-label">When to seek care</dt>
        <dd className="t-body-sm">
          Cough persisting beyond 8 weeks, blood in sputum, unexplained weight loss, or fever above 38.5 °C.
        </dd>
      </div>
      <div className="rx-deflist__note">
        <dd className="t-body-sm" style={{ color: 'var(--text-secondary)' }}>
          This information is general and not a substitute for professional medical advice. If symptoms are severe or worsening, contact a clinician.
        </dd>
      </div>
    </dl>
  )
}

// ── Type guards ──────────────────────────────────────────────────────────────

function isEmptyResult(value: unknown): value is { found: false } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'found' in value &&
    (value as { found: unknown }).found === false
  )
}

function isDrugNotFound(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const err = (value as { error: unknown }).error
  if (typeof err !== 'object' || err === null || !('code' in err)) return false
  return (err as { code: unknown }).code === 'DRUG_NOT_FOUND'
}
