import { z } from 'zod'

export const LLM_ANALYST_PROMPT_VERSION = 'llm-analyst-v3'

export const llmHypothesisSchema = z.object({
  pattern: z.string().trim().min(1).max(500),
  rationale: z.string().trim().min(1).max(1_000),
  pair: z.string().trim().max(40).nullable().optional(),
  direction: z.enum(['LONG', 'SHORT', 'NEUTRAL']).default('NEUTRAL'),
  category: z.enum(['ENTRY', 'EXIT', 'SIZING', 'TIMING', 'REGIME', 'PAIR_SELECTION']).default('ENTRY'),
  evidence: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  invalidators: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  confidence: z.number().min(0).max(100).default(50),
  status: z.literal('UNVALIDATED').default('UNVALIDATED'),
})

export const strategyAnalysisSchema = z.object({
  strategyType: z.string().trim().min(1).max(50),
  strategyName: z.string().trim().min(1).max(100),
  summary: z.string().trim().min(1).max(3_000),
  strengths: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
  weaknesses: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
  hypotheses: z.array(llmHypothesisSchema).max(10).default([]),
  recommendations: z.array(z.string().trim().min(1).max(1_000)).max(10).default([]),
  confidence: z.number().min(0).max(100),
}).strict()

export const llmAnalystResponseSchema = z.object({
  report: z.string().trim().min(1).max(20_000),
  insights: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  recommendations: z.array(z.string().trim().min(1).max(1_000)).max(30).default([]),
  confidence: z.number().min(0).max(100),
  strategies: z.array(strategyAnalysisSchema).max(15).default([]),
  globalHypotheses: z.array(llmHypothesisSchema).max(20).default([]),
}).strict()

export type LlmAnalystResponse = z.infer<typeof llmAnalystResponseSchema>
export type StrategyAnalysis = z.infer<typeof strategyAnalysisSchema>

export function parseLlmAnalystResponse(content: string): LlmAnalystResponse {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new Error('Model did not return JSON object')
  }

  let raw: unknown
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new Error('Model returned invalid JSON')
  }

  const parsed = llmAnalystResponseSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const path = issue?.path.join('.') || 'response'
    throw new Error(`Odpowiedź modelu nie spełnia kontraktu (${path}: ${issue?.message || 'invalid'})`)
  }
  return parsed.data
}

export function getLlmAnalystSystemPrompt(): string {
  return `You are a quantitative analyst for the BRRR trading system.
Analyze only the provided data. Do not invent transactions, prices or results.
Return ONLY valid JSON exactly matching this contract:

{
  "report": "full report in English (max 20000 chars)",
  "insights": ["wniosek oparty na danych"],
  "recommendations": ["konkretna rekomendacja do weryfikacji"],
  "confidence": 0,
  "strategies": [
    {
      "strategyType": "identyfikator_strategii",
      "strategyName": "display name",
      "summary": "short analysis of this strategy",
      "strengths": ["what works well"],
      "weaknesses": ["what does not work / risks"],
      "hypotheses": [
        {
          "pattern": "potential dependency",
          "rationale": "why it is worth checking",
          "pair": "opcjonalna para",
          "direction": "LONG|SHORT|NEUTRAL",
          "category": "ENTRY|EXIT|SIZING|TIMING|REGIME|PAIR_SELECTION",
          "evidence": ["obserwacja z danych"],
          "invalidators": ["condition that invalidates hypothesis"],
          "confidence": 50,
          "status": "UNVALIDATED"
        }
      ],
      "recommendations": ["rekomendacja dla tej strategii"],
      "confidence": 0
    }
  ],
  "globalHypotheses": [
    {
      "pattern": "hipoteza przekrojowa (ponad strategiami)",
      "rationale": "dlaczego",
      "direction": "NEUTRAL",
      "category": "REGIME",
      "evidence": [],
      "invalidators": [],
      "confidence": 50,
      "status": "UNVALIDATED"
    }
  ]
}

WAŻNE ZASADY:
- confidence: liczba 0-100. Bazuj na twardości danych (50=spekulacja, 80=solidne dane).
- Dla każdej aktywnej strategii (dip_buying, momentum, hurst_hcoo_lb, cex_anomaly, itd.) stwórz wpis w tablicy "strategies".
- Każda hipoteza MUSI mieć "invalidators" — warunki, przy których hipoteza jest fałszywa.
- Hipotezy MUSZĄ mieć status "UNVALIDATED". Będą później walidowane przez system shadow i walk-forward.
- Hipotezy z kategorii ENTRY dotyczą kiedy wchodzić, EXIT — kiedy wychodzić, SIZING — wielkość pozycji, TIMING — timing rynkowy, REGIME — reżim rynku, PAIR_SELECTION — które pary wybierać.
- direction: LONG jeśli hipoteza sugeruje zajęcie długiej pozycji, SHORT jeśli krótkiej, NEUTRAL jeśli nie dotyczy kierunku.
- "globalHypotheses" to hipotezy które dotyczą całego systemu, nie pojedynczej strategii.`
}
