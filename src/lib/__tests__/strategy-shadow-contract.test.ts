import { describe, expect, it } from 'vitest'
import { parseStrategyShadowResponse } from '../strategy-shadow-contract'

const valid = {
  recommendation: 'CAUTION',
  confidence: 68,
  thesis: 'Momentum is positive, but volatility remains high.',
  arguments: ['Zmiana 1h jest dodatnia.'],
  invalidators: ['Price drop below the 24h low.'],
}

describe('parseStrategyShadowResponse', () => {
  it('accepts a valid shadow response', () => {
    expect(parseStrategyShadowResponse(JSON.stringify(valid))).toEqual(valid)
  })

  it('rejects execution instructions and extra fields', () => {
    expect(() => parseStrategyShadowResponse(JSON.stringify({
      ...valid,
      orderSize: 1_000,
    }))).toThrow(/kontraktu/)
  })

  it('rejects unknown recommendations', () => {
    expect(() => parseStrategyShadowResponse(JSON.stringify({
      ...valid,
      recommendation: 'BUY_NOW',
    }))).toThrow(/recommendation/)
  })
})
