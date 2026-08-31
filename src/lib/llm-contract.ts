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
    throw new Error(`Model response does not match contract (${path}: ${issue?.message || 'invalid'})`)
  }
  return parsed.data
}

export function getLlmAnalystSystemPrompt(): string {
  return `You are a quantitative analyst for the BRRR trading system.
Analyze only the provided data. Do not invent transactions, prices or results.
Return ONLY valid JSON exactly matching this contract:

{
  "report": "full report in English (max 20000 chars)",
  "insights": ["data-based insight"],
  "recommendations": ["specific recommendation to verify"],
  "confidence": 0,
  "strategies": [
    {
      "strategyType": "strategy_identifier",
      "strategyName": "display name",
      "summary": "short analysis of this strategy",
      "strengths": ["what works well"],
      "weaknesses": ["what does not work / risks"],
      "hypotheses": [
        {
          "pattern": "potential dependency",
          "rationale": "why it is worth checking",
          "pair": "optional pair",
          "direction": "LONG|SHORT|NEUTRAL",
          "category": "ENTRY|EXIT|SIZING|TIMING|REGIME|PAIR_SELECTION",
          "evidence": ["observation from data"],
          "invalidators": ["condition that invalidates hypothesis"],
          "confidence": 50,
          "status": "UNVALIDATED"
        }
      ],
      "recommendations": ["recommendation for this strategy"],
      "confidence": 0
    }
  ],
  "globalHypotheses": [
    {
      "pattern": "cross-cutting hypothesis (across strategies)",
      "rationale": "why",
      "direction": "NEUTRAL",
      "category": "REGIME",
      "evidence": [],
      "invalidators": [],
      "confidence": 50,
      "status": "UNVALIDATED"
    }
  ]
}

KEY RULES:
- confidence: number 0-100. Base it on data solidity (50=speculation, 80=solid data).
- For each active strategy (dip_buying, momentum, hurst_hcoo_lb, cex_anomaly, etc.) create an entry in the "strategies" array.
- Every hypothesis MUST have "invalidators" — conditions under which the hypothesis is false.
- Hypotheses MUST have status "UNVALIDATED". They will be validated later by the shadow system and walk-forward evaluation.
- ENTRY hypotheses concern when to enter, EXIT — when to exit, SIZING — position size, TIMING — market timing, REGIME — market regime, PAIR_SELECTION — which pairs to pick.
- direction: LONG if the hypothesis suggests a long position, SHORT if short, NEUTRAL if direction-agnostic.
- "globalHypotheses" are hypotheses that concern the whole system, not a single strategy.`
}
