import { ChevronRight } from './icons'

export const DEFAULT_PROMPTS: ReadonlyArray<string> = [
  'What does lisinopril do, and what are the key warnings?',
  'I have a persistent dry cough — what could cause it?',
  'Can I take ibuprofen with a blood-pressure medication?',
  'Difference between metoprolol tartrate and succinate?',
]

type PromptSuggestionsProps = {
  prompts?: ReadonlyArray<string>
  onSelect?: (prompt: string) => void
}

export function PromptSuggestions({ prompts = DEFAULT_PROMPTS, onSelect }: PromptSuggestionsProps) {
  return (
    <div className="rx-prompts">
      {prompts.map((p) => (
        <button
          type="button"
          key={p}
          className="rx-prompts__item"
          onClick={() => onSelect?.(p)}
        >
          <span className="t-body-md">{p}</span>
          <span className="rx-prompts__arrow">
            <ChevronRight size={14} />
          </span>
        </button>
      ))}
    </div>
  )
}
