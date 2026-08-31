import { describe, expect, it } from 'vitest'
import {
  BinanceClient,
  createBinanceClient,
  toBinanceSymbol,
} from '@/lib/binance'

describe('Binance trading removal', () => {
  it('blocks direct authenticated clients', () => {
    expect(() => new BinanceClient({
      apiKey: 'unused',
      apiSecret: 'unused',
      mode: 'real',
    })).toThrow('Handel przez Binance został wyłączony')
  })

  it('blocks clients created from stored credentials', async () => {
    await expect(createBinanceClient('real')).rejects.toThrow(
      'Handel przez Binance został wyłączony'
    )
  })

  it('keeps public market symbol mapping available', () => {
    expect(toBinanceSymbol('btc')).toBe('BTCUSDT')
  })
})
