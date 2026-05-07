import { describe, expect, test } from 'bun:test'
import type { ZodType } from 'zod'
import {
  createDrugInfoTool,
  type Fetcher,
} from '../../../src/agent/tools/drug_info'

const fakeOpenFdaResponse = {
  results: [
    {
      openfda: { brand_name: ['Advil'], generic_name: ['IBUPROFEN'] },
      indications_and_usage: ['For relief of pain and reduction of fever.'],
      warnings: ['Allergy alert: ibuprofen may cause a severe allergic reaction.'],
      dosage_and_administration: ['Adults: 200-400 mg every 4 to 6 hours.'],
    },
  ],
}

function fakeFetch(impl: (url: string) => Promise<Response>): Fetcher {
  return (input) => impl(typeof input === 'string' ? input : input.toString())
}

describe('drug_info tool (U-3)', () => {
  test('exposes the AI SDK tool shape — description, inputSchema, execute', () => {
    const t = createDrugInfoTool({ timeoutMs: 5000 })
    expect(typeof t.description).toBe('string')
    expect((t.description ?? '').length).toBeGreaterThan(10)
    expect(t.inputSchema).toBeDefined()
    expect(typeof t.execute).toBe('function')
  })

  test('happy path: openFDA 200 → normalized {name, indications, warnings, dosage}', async () => {
    let calledUrl = ''
    const fetcher = fakeFetch(async (url) => {
      calledUrl = url
      return new Response(JSON.stringify(fakeOpenFdaResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })

    const t = createDrugInfoTool({ timeoutMs: 5000, fetcher })
    const out = (await t.execute!({ query: 'ibuprofen' }, {} as never)) as {
      name: string
      indications: string
      warnings: string
      dosage: string
    }
    // openFDA prefers brand_name; the fixture returns "Advil" (the brand for ibuprofen).
    expect(out.name).toBe('Advil')
    expect(out.indications).toContain('pain')
    expect(out.warnings).toContain('allergic')
    expect(out.dosage).toContain('200-400 mg')
    expect(calledUrl).toContain('api.fda.gov/drug/label.json')
    expect(calledUrl).toContain('ibuprofen')
  })

  test('404 → structured tool error with code DRUG_NOT_FOUND', async () => {
    const fetcher = fakeFetch(
      async () =>
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), {
          status: 404,
        }),
    )
    const t = createDrugInfoTool({ timeoutMs: 5000, fetcher })
    const out = (await t.execute!({ query: 'unobtanium' }, {} as never)) as {
      error: { code: string; message: string }
    }
    expect(out.error?.code).toBe('DRUG_NOT_FOUND')
    expect(out.error?.message).toMatch(/unobtanium/i)
  })

  test('5xx → structured tool error with code UPSTREAM_ERROR', async () => {
    const fetcher = fakeFetch(async () => new Response('upstream fail', { status: 502 }))
    const t = createDrugInfoTool({ timeoutMs: 5000, fetcher })
    const out = (await t.execute!({ query: 'ibuprofen' }, {} as never)) as {
      error: { code: string }
    }
    expect(out.error?.code).toBe('UPSTREAM_ERROR')
  })

  test('TOOL_TIMEOUT_MS exceeded → UPSTREAM_TIMEOUT (F-4)', async () => {
    // A fetch that never resolves on its own but respects abortSignal.
    const slowFetch: Fetcher = (_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        })
      })

    const t = createDrugInfoTool({ timeoutMs: 50, fetcher: slowFetch })
    const t0 = performance.now()
    const out = (await t.execute!({ query: 'ibuprofen' }, {} as never)) as {
      error: { code: string }
    }
    const elapsed = performance.now() - t0
    expect(out.error?.code).toBe('UPSTREAM_TIMEOUT')
    expect(elapsed).toBeLessThan(500)
  })

  test('rejects empty query at the inputSchema layer (F-14 prerequisite)', () => {
    const t = createDrugInfoTool({ timeoutMs: 5000 })
    const schema = t.inputSchema as ZodType
    expect(schema.safeParse({ query: '' }).success).toBe(false)
  })

  test('rejects missing query at the inputSchema layer', () => {
    const t = createDrugInfoTool({ timeoutMs: 5000 })
    const schema = t.inputSchema as ZodType
    expect(schema.safeParse({}).success).toBe(false)
  })
})
