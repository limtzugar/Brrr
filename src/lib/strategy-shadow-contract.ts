import { z } from 'zod'

export const STRATEGY_SHADOW_PROMPT_VERSION = 'strategy-shadow-v1'

export const strategyShadowResponseSchema = z.object({
  recommendation: z.enum(['ALLOW', 'CAUTION', 'AVOID']),
  confidence: z.number().min(0).max(100),
  thesis: z.string().trim().min(1).max(2_000),
  arguments: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
  invalidators: z.array(z.string().trim().min(1).max(500)).min(1).max(10),
}).strict()

export type StrategyShadowResponse = z.infer<typeof strategyShadowResponseSchema>

export function parseStrategyShadowResponse(content: string): StrategyShadowResponse {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('Model shadow nie zwrócił obiektu JSON')

  let raw: unknown
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new Error('Model shadow zwrócił nieprawidłowy JSON')
  }

  const parsed = strategyShadowResponseSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(
      `Odpowiedź shadow nie spełnia kontraktu (${issue?.path.join('.') || 'response'}: ${issue?.message || 'invalid'})`,
    )
  }
  return parsed.data
}

export function getStrategyShadowSystemPrompt(): string {
  return `Jesteś niezależnym recenzentem decyzji strategii tradingowej.
Decyzja bazowa została już podjęta. Nie wykonujesz transakcji i nie zmieniasz jej.
Oceń jakość setupu wyłącznie na podstawie przekazanej migawki.
Zwróć WYŁĄCZNIE poprawny JSON:
{
  "recommendation": "ALLOW|CAUTION|AVOID",
  "confidence": 0,
  "thesis": "krótka teza po polsku",
  "arguments": ["argument oparty na danych"],
  "invalidators": ["warunek unieważniający tezę"]
}
confidence musi być liczbą 0-100. Nie dopisuj danych, których nie ma w wejściu.`
}
