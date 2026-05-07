import { tool } from 'ai'
import { z } from 'zod'

const InputSchema = z.object({
  query: z
    .string()
    .min(1, 'query must be a non-empty drug name')
    .max(120, 'query is too long'),
})

/**
 * Narrow fetcher type — avoids requiring `preconnect` from Bun's `typeof fetch`,
 * and keeps the tool decoupled from the global type. Tests pass any function
 * matching this shape.
 */
export type Fetcher = (
  url: string | URL,
  init?: { signal?: AbortSignal },
) => Promise<Response>

export type DrugInfoDeps = {
  /** Per-tool timeout budget — independent of AI_TIMEOUT_MS. F-4. */
  timeoutMs: number
  /** Inject a fetcher in tests. Defaults to global `fetch`. */
  fetcher?: Fetcher
}

type DrugInfoSuccess = {
  name: string
  indications: string
  warnings: string
  dosage: string
}

type DrugInfoError = {
  error: { code: 'DRUG_NOT_FOUND' | 'UPSTREAM_TIMEOUT' | 'UPSTREAM_ERROR'; message: string }
}

export type DrugInfoOutput = DrugInfoSuccess | DrugInfoError

type FdaResult = {
  openfda?: { brand_name?: string[]; generic_name?: string[] }
  indications_and_usage?: string[]
  warnings?: string[]
  dosage_and_administration?: string[]
}

const DESCRIPTION = `Look up FDA drug label information for a US-approved medication. \
Given a drug name (brand or generic), returns its name, indications, warnings, and \
dosage as published on the openFDA drug-label dataset. Returns { error: { code, \
message } } if no label is found, the upstream service errors, or the lookup times \
out. This is informational only; remind the user to consult a clinician.`

export function createDrugInfoTool(deps: DrugInfoDeps) {
  const fetcher = deps.fetcher ?? fetch
  return tool({
    description: DESCRIPTION,
    inputSchema: InputSchema,
    execute: async ({ query }): Promise<DrugInfoOutput> => {
      const url = `https://api.fda.gov/drug/label.json?search=${encodeURIComponent(
        query,
      )}&limit=1`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), deps.timeoutMs)

      try {
        const res = await fetcher(url, { signal: controller.signal })

        if (res.status === 404) {
          return {
            error: {
              code: 'DRUG_NOT_FOUND',
              message: `No FDA drug label found for "${query}".`,
            },
          }
        }
        if (!res.ok) {
          return {
            error: {
              code: 'UPSTREAM_ERROR',
              message: `openFDA returned HTTP ${res.status}`,
            },
          }
        }

        const json = (await res.json()) as { results?: FdaResult[] }
        const r = json.results?.[0]
        if (!r) {
          return {
            error: {
              code: 'DRUG_NOT_FOUND',
              message: `No FDA drug label found for "${query}".`,
            },
          }
        }
        const name =
          r.openfda?.brand_name?.[0] ??
          r.openfda?.generic_name?.[0] ??
          query
        return {
          name,
          indications: joinOrFallback(r.indications_and_usage),
          warnings: joinOrFallback(r.warnings),
          dosage: joinOrFallback(r.dosage_and_administration),
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return {
            error: {
              code: 'UPSTREAM_TIMEOUT',
              message: `openFDA request exceeded ${deps.timeoutMs}ms`,
            },
          }
        }
        return {
          error: {
            code: 'UPSTREAM_ERROR',
            message: err instanceof Error ? err.message : 'unknown upstream error',
          },
        }
      } finally {
        clearTimeout(timer)
      }
    },
  })
}

function joinOrFallback(arr: string[] | undefined): string {
  const joined = (arr ?? []).join('\n').trim()
  return joined || 'Not provided.'
}
