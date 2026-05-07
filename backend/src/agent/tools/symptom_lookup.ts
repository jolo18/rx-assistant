import { tool } from 'ai'
import { z } from 'zod'
import symptomsData from '../data/symptoms.json' with { type: 'json' }

const InputSchema = z.object({
  symptom: z
    .string()
    .min(1, 'symptom must be a non-empty string')
    .max(500, 'symptom description is too long'),
})

type SymptomEntry = {
  name: string
  aliases: string[]
  description: string
  commonCauses: string[]
  whenToSeekCare: string
}

type Catalog = { disclaimer: string; entries: SymptomEntry[] }

const catalog = symptomsData as Catalog

type SymptomFound = {
  found: true
  name: string
  description: string
  commonCauses: string[]
  whenToSeekCare: string
  disclaimer: string
}

type SymptomNotFound = {
  found: false
  query: string
  disclaimer: string
  suggestion: string
}

export type SymptomLookupOutput = SymptomFound | SymptomNotFound

const DESCRIPTION = `Look up information about a common symptom from a curated, \
non-PHI knowledge base. Given a symptom (e.g. "headache", "chest pain"), returns its \
description, common causes, and guidance on when to seek care. Always includes a \
disclaimer that this is informational, not medical advice. Returns { found: false, \
suggestion } when the symptom isn't in the catalog.`

function findEntry(query: string): SymptomEntry | null {
  const q = query.trim().toLowerCase()
  if (!q) return null

  // 1. Exact match against name or alias.
  for (const entry of catalog.entries) {
    if (entry.name.toLowerCase() === q) return entry
    if (entry.aliases.some((a) => a.toLowerCase() === q)) return entry
  }

  // 2. Substring match — entry name appears in the user's query, or vice-versa.
  for (const entry of catalog.entries) {
    const name = entry.name.toLowerCase()
    if (q.includes(name) || name.includes(q)) return entry
    if (entry.aliases.some((a) => q.includes(a.toLowerCase()))) return entry
  }

  return null
}

export function createSymptomLookupTool() {
  return tool({
    description: DESCRIPTION,
    inputSchema: InputSchema,
    execute: async ({ symptom }): Promise<SymptomLookupOutput> => {
      const entry = findEntry(symptom)
      if (!entry) {
        return {
          found: false,
          query: symptom,
          disclaimer: catalog.disclaimer,
          suggestion:
            'This symptom is not in the catalog. Please consult a clinician for personalized guidance.',
        }
      }
      return {
        found: true,
        name: entry.name,
        description: entry.description,
        commonCauses: entry.commonCauses,
        whenToSeekCare: entry.whenToSeekCare,
        disclaimer: catalog.disclaimer,
      }
    },
  })
}
