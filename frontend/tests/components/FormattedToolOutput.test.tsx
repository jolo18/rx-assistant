import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormattedToolOutput } from '../../src/components/FormattedToolOutput'
import type { ToolResultOutput } from '../../src/lib/chat-events'

describe('FormattedToolOutput — spec §4 Slice 12 branches', () => {
  test('drug_info success renders the deflist', () => {
    render(<FormattedToolOutput name="drug_info" state="complete-success" />)
    expect(screen.getByText('Name')).toBeInTheDocument()
    expect(screen.getByText(/Lisinopril/)).toBeInTheDocument()
    expect(screen.getByText('Adult dosage')).toBeInTheDocument()
  })

  test('symptom_lookup success renders the symptom deflist', () => {
    render(<FormattedToolOutput name="symptom_lookup" state="complete-success" />)
    expect(screen.getByText('Description')).toBeInTheDocument()
    expect(screen.getByText('Common causes')).toBeInTheDocument()
    expect(screen.getByText('When to seek care')).toBeInTheDocument()
  })

  test('complete-error renders the upstream error branch with derived message', () => {
    const errOutput: ToolResultOutput = { type: 'error-text', value: 'openFDA 503' }
    render(<FormattedToolOutput name="drug_info" state="complete-error" output={errOutput} />)
    expect(screen.getByText(/Upstream service returned/i)).toBeInTheDocument()
    expect(screen.getByText('openFDA 503')).toBeInTheDocument()
  })

  test('complete-error without output text falls back to a generic 503 string', () => {
    render(<FormattedToolOutput name="drug_info" state="complete-error" />)
    expect(screen.getByText('503 Service Unavailable')).toBeInTheDocument()
  })

  test('symptom_lookup empty result ({found: false}) renders the no-match branch', () => {
    const out: ToolResultOutput = { type: 'json', value: { found: false } }
    render(
      <FormattedToolOutput name="symptom_lookup" state="complete-success" output={out} />,
    )
    expect(screen.getByText(/No matching symptom/i)).toBeInTheDocument()
    // And NOT the success deflist
    expect(screen.queryByText('Description')).toBeNull()
  })

  test('drug_info DRUG_NOT_FOUND renders the 404-style branch', () => {
    const out: ToolResultOutput = {
      type: 'json',
      value: { error: { code: 'DRUG_NOT_FOUND' } },
    }
    render(<FormattedToolOutput name="drug_info" state="complete-success" output={out} />)
    expect(screen.getByText(/drug name was not found/i)).toBeInTheDocument()
    expect(screen.queryByText('Adult dosage')).toBeNull()
  })

  test('non-empty success output still renders the sample deflist (slice 12 scope)', () => {
    const out: ToolResultOutput = { type: 'json', value: { name: 'ibuprofen' } }
    render(<FormattedToolOutput name="drug_info" state="complete-success" output={out} />)
    expect(screen.getByText('Adult dosage')).toBeInTheDocument()
  })
})
