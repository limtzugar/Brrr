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
    })).toThrow('Trading via Binance has been disabled')
  })

  it('blocks clients created from stored credentials', async () => {
    await expect(createBinanceClient('real')).rejects.toThrow(
      'Trading via Binance has been disabled'
    )
  })

  it('keeps public market symbol mapping available', () => {
    expect(toBinanceSymbol('btc')).toBe('BTCUSDT')
  })
})
