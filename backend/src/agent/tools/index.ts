import { createDrugInfoTool } from './drug_info.ts'
import { createSymptomLookupTool } from './symptom_lookup.ts'

export type ToolEnv = {
  TOOL_TIMEOUT_MS: number
}

export function createTools(env: ToolEnv) {
  return {
    drug_info: createDrugInfoTool({ timeoutMs: env.TOOL_TIMEOUT_MS }),
    symptom_lookup: createSymptomLookupTool(),
  }
}

export type Tools = ReturnType<typeof createTools>
