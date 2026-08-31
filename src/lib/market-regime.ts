export type DerivedMarketRegime = 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | 'MIXED' | 'UNKNOWN'

export function deriveMarketRegime(
  priceChange24h: number | null | undefined,
  priceChange7d: number | null | undefined,
): DerivedMarketRegime {
  if (!Number.isFinite(priceChange24h)) return 'UNKNOWN'
  const change24h = priceChange24h as number
  const change7d = Number.isFinite(priceChange7d) ? priceChange7d as number : 0

  if (Math.abs(change24h) < 2 && Math.abs(change7d) < 5) return 'SIDEWAYS'
  if (change24h >= 2 && change7d >= 0) return 'BULLISH'
  if (change24h <= -2 && change7d <= 0) return 'BEARISH'
  return 'MIXED'
}
