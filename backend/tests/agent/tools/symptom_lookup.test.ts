import { describe, expect, test } from 'bun:test'
import type { ZodType } from 'zod'
import { createSymptomLookupTool } from '../../../src/agent/tools/symptom_lookup'

describe('symptom_lookup tool (U-4)', () => {
  test('exposes AI SDK tool shape', () => {
    const t = createSymptomLookupTool()
    expect(typeof t.description).toBe('string')
    expect((t.description ?? '').length).toBeGreaterThan(10)
    expect(t.inputSchema).toBeDefined()
    expect(typeof t.execute).toBe('function')
  })

  test('exact match returns full entry plus disclaimer', async () => {
    const t = createSymptomLookupTool()
    const out = (await t.execute!({ symptom: 'headache' }, {} as never)) as {
      found: boolean
      name: string
      description: string
      commonCauses: string[]
      whenToSeekCare: string
      disclaimer: string
    }
    expect(out.found).toBe(true)
    expect(out.name).toBe('headache')
    expect(out.description.length).toBeGreaterThan(10)
    expect(out.commonCauses.length).toBeGreaterThan(0)
    expect(out.whenToSeekCare.length).toBeGreaterThan(10)
    expect(out.disclaimer).toMatch(/not medical advice/i)
  })

  test('case-insensitive exact match', async () => {
    const t = createSymptomLookupTool()
    const out = (await t.execute!({ symptom: 'HEADACHE' }, {} as never)) as {
      found: boolean
      name: string
    }
    expect(out.found).toBe(true)
    expect(out.name).toBe('headache')
  })

  test('fuzzy: alias resolves to canonical entry', async () => {
    const t = createSymptomLookupTool()
    const out = (await t.execute!({ symptom: 'head pain' }, {} as never)) as {
      found: boolean
      name: string
    }
    expect(out.found).toBe(true)
    expect(out.name).toBe('headache')
  })

  test('fuzzy: substring matches when symptom contains entry name', async () => {
    const t = createSymptomLookupTool()
    const out = (await t.execute!(
      { symptom: 'I have a really bad headache today' },
      {} as never,
    )) as {
      found: boolean
      name: string
    }
    expect(out.found).toBe(true)
    expect(out.name).toBe('headache')
  })

  test('unknown symptom returns { found: false } + disclaimer (no diagnosis)', async () => {
    const t = createSymptomLookupTool()
    const out = (await t.execute!({ symptom: 'left-foot tingling' }, {} as never)) as {
      found: boolean
      disclaimer: string
      suggestion?: string
    }
    expect(out.found).toBe(false)
    expect(out.disclaimer).toMatch(/not medical advice/i)
    expect(out.suggestion?.toLowerCase()).toContain('clinician')
  })

  test('output for known entry never omits the disclaimer (NFR-9 / safety)', async () => {
    const t = createSymptomLookupTool()
    for (const s of ['fever', 'cough', 'chest pain', 'fatigue']) {
      const out = (await t.execute!({ symptom: s }, {} as never)) as {
        disclaimer?: string
      }
      expect(out.disclaimer).toMatch(/not medical advice/i)
    }
  })

  test('rejects empty symptom at inputSchema layer (F-14)', () => {
    const t = createSymptomLookupTool()
    const schema = t.inputSchema as ZodType
    expect(schema.safeParse({ symptom: '' }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
  })
})
