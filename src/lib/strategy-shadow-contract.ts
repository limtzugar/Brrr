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
  if (start < 0 || end <= start) throw new Error('Shadow model did not return a JSON object')

  let raw: unknown
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new Error('Shadow model returned invalid JSON')
  }

  const parsed = strategyShadowResponseSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(
      `Shadow response does not match contract (${issue?.path.join('.') || 'response'}: ${issue?.message || 'invalid'})`,
    )
  }
  return parsed.data
}

export function getStrategyShadowSystemPrompt(): string {
  return `You are an independent reviewer of a trading strategy decision.
The base decision has already been made. You do not execute trades and you do not change it.
Assess the quality of the setup based solely on the provided snapshot.
Return ONLY valid JSON:
{
  "recommendation": "ALLOW|CAUTION|AVOID",
  "confidence": 0,
  "thesis": "short thesis",
  "arguments": ["data-based argument"],
  "invalidators": ["condition that invalidates the thesis"]
}
confidence must be a number 0-100. Do not invent data not present in the input.`
}
