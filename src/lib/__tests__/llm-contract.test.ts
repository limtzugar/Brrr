import { describe, expect, it } from 'vitest'
import { parseLlmAnalystResponse } from '../llm-contract'

const validResponse = {
  report: 'The market remains volatile.',
  insights: ['Exposure is concentrated.'],
  recommendations: ['Reduce the maximum position size.'],
  confidence: 72,
  strategies: [],
  globalHypotheses: [{
    pattern: 'High funding can precede a pullback.',
    rationale: 'Signal convergence occurred in the data.',
    pair: 'BTCUSDT',
    direction: 'NEUTRAL',
    category: 'REGIME',
    evidence: ['Funding was positive while OI was rising.'],
    invalidators: ['No pullback in the next validation window.'],
    confidence: 50,
    status: 'UNVALIDATED',
  }],
}

describe('parseLlmAnalystResponse', () => {
  it('accepts a valid response contract', () => {
    expect(parseLlmAnalystResponse(JSON.stringify(validResponse))).toEqual(validResponse)
  })

  it('accepts JSON wrapped in a markdown code fence', () => {
    const parsed = parseLlmAnalystResponse(`\`\`\`json\n${JSON.stringify(validResponse)}\n\`\`\``)
    expect(parsed.confidence).toBe(72)
  })

  it('accepts null pair for a hypothesis that is not pair-specific', () => {
    const response = {
      ...validResponse,
      globalHypotheses: [{
        ...validResponse.globalHypotheses[0],
        pair: null,
      }],
    }
    expect(parseLlmAnalystResponse(JSON.stringify(response))
      .globalHypotheses[0].pair).toBeNull()
  })

  it('rejects confidence outside the supported range', () => {
    expect(() => parseLlmAnalystResponse(JSON.stringify({
      ...validResponse,
      confidence: 101,
    }))).toThrow(/confidence/)
  })

  it('rejects the removed self-confirming learned-pattern contract', () => {
    const { globalHypotheses: _globalHypotheses, ...legacy } = validResponse
    expect(() => parseLlmAnalystResponse(JSON.stringify({
      ...legacy,
      newPatterns: [{ pattern: 'legacy', outcome: 'WIN' }],
    }))).toThrow(/kontrakt/i)
  })
})
