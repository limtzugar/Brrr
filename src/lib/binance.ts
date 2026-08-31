// ─── Binance REST API Client ────────────────────────────────────────────────
// Supports spot trading with HMAC-SHA256 authentication.
// Binance Fee Structure: Maker 0.10%, Taker 0.10% (default VIP 0)

import { createHmac } from 'crypto'

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE_URLS = {
  demo: 'https://testnet.binance.vision',
  real: 'https://api.binance.com',
} as const

export type BinanceMode = 'demo' | 'real'

interface BinanceConfig {
  apiKey: string
  apiSecret: string
  mode: BinanceMode
}

// ─── Fee Structure ──────────────────────────────────────────────────────────

export const BINANCE_FEES = {
  maker: 0.1,   // 0.10%
  taker: 0.1,   // 0.10%
  /** Default fee for backtest/strategy: average of maker+taker = 0.10% */
  default: 0.1, // average for backtest estimation
} as const

/** Coin ID to Binance symbol mapping */
export const COIN_TO_BINANCE: Record<string, string> = {
  btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT', xrp: 'XRPUSDT',
  doge: 'DOGEUSDT', ada: 'ADAUSDT', dot: 'DOTUSDT', matic: 'MATICUSDT',
  avax: 'AVAXUSDT', link: 'LINKUSDT', uni: 'UNIUSDT', atom: 'ATOMUSDT',
  ltc: 'LTCUSDT', bnb: 'BNBUSDT', near: 'NEARUSDT', apt: 'APTUSDT',
  arb: 'ARBUSDT', op: 'OPUSDT', inj: 'INJUSDT', sui: 'SUIUSDT',
  pepe: 'PEPEUSDT', rndr: 'RNDRUSDT',
  fil: 'FILUSDT', ton: 'TONUSDT', kas: 'KASUSDT', fet: 'FETUSDT',
  trump: 'TRUMPUSDT', wld: 'WLDUSDT',
}

/** Coin ID to Binance USDC symbol mapping */
export const COIN_TO_BINANCE_USDC: Record<string, string> = {
  btc: 'BTCUSDC', eth: 'ETHUSDC', sol: 'SOLUSDC', xrp: 'XRPUSDC',
  doge: 'DOGEUSDC', ada: 'ADAUSDC', dot: 'DOTUSDC', matic: 'MATICUSDC',
  avax: 'AVAXUSDC', link: 'LINKUSDC', uni: 'UNIUSDC', atom: 'ATOMUSDC',
  ltc: 'LTCUSDC', bnb: 'BNBUSDC', near: 'NEARUSDC', apt: 'APTUSDC',
  arb: 'ARBUSDC', op: 'OPUSDC', inj: 'INJUSDC', sui: 'SUIUSDC',
  pepe: 'PEPEUSDC', rndr: 'RNDRUSDC',
  fil: 'FILUSDC', ton: 'TONUSDC', kas: 'KASUSDC', fet: 'FETUSDC',
  shib: 'SHIBUSDC', xlm: 'XLMUSDC', trump: 'TRUMPUSDC', wld: 'WLDUSDC',
}

/** Resolve coin ID to Binance trading symbol (USDT pairs) */
export function toBinanceSymbol(coinId: string): string {
  return COIN_TO_BINANCE[coinId] || coinId.toUpperCase() + 'USDT'
}

/** Resolve coin ID to Binance trading symbol (USDC pairs) */
export function toBinanceSymbolUSDC(coinId: string): string {
  return COIN_TO_BINANCE_USDC[coinId] || coinId.toUpperCase() + 'USDC'
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface OrderResult {
  orderId: string
  orderLinkId: string
  price: string
  quantity: string
  amount: string
  dealQuantity: string
  dealAmount: string
  side: string
  type: string
  status: string
  createTime: number
  avgPrice: string
}

export interface CoinBalance {
  coin: string
  equity: string
  available: string
  locked: string
  walletBalance: string
  free: string
}

export interface BinanceOpenOrder {
  symbol: string
  orderId: string
  clientOrderId: string
  price: string
  origQty: string
  executedQty: string
  cummulativeQuoteQty: string
  status: string
  type: string
  side: string
  time: number
  updateTime: number
  timeInForce: string
}

export interface OrderBookEntry {
  price: number
  quantity: number
  total: number
}

export interface OrderBookData {
  bids: OrderBookEntry[]
  asks: OrderBookEntry[]
  lastUpdateId: number
}

// ─── Authentication ─────────────────────────────────────────────────────────

function generateSignature(params: string, apiSecret: string): string {
  return createHmac('sha256', apiSecret).update(params).digest('hex')
}

function buildQueryString(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

// ─── API Client Class ───────────────────────────────────────────────────────

export class BinanceClient {
  private config: BinanceConfig
  private baseUrl: string

  constructor(config: BinanceConfig) {
    throw new Error('Handel przez Binance został wyłączony. Publiczne dane rynkowe Binance pozostają dostępne.')
    this.config = {
      apiKey: config.apiKey.trim(),
      apiSecret: config.apiSecret.trim(),
      mode: config.mode,
    }
    this.baseUrl = BASE_URLS[config.mode]
  }

  private async request(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}, _retries = 3): Promise<any> {
    const timestamp = Date.now()
    params.timestamp = timestamp
    params.recvWindow = 5000

    const queryString = buildQueryString(params)
    const signature = generateSignature(queryString, this.config.apiSecret)

    const headers: Record<string, string> = {
      'X-MBX-APIKEY': this.config.apiKey,
    }

    let url: string
    let fetchOptions: RequestInit

    if (method === 'POST') {
      // Binance spot API: POST params go in the query string (including signature)
      // NOT in the body — body must be empty
      url = `${this.baseUrl}${path}?${queryString}&signature=${signature}`
      fetchOptions = {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(15000),
      }
    } else {
      // GET / DELETE: params in query string with signature
      url = `${this.baseUrl}${path}?${queryString}&signature=${signature}`
      fetchOptions = {
        method,
        headers,
        signal: AbortSignal.timeout(15000),
      }
    }

    const res = await fetch(url, fetchOptions)

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({})) as any
      const msg = errorData?.msg || errorData?.message || `Binance API error: ${res.status}`

      // Retry on 429 (rate limit) or 418 (auto-ban) with exponential backoff
      if ((res.status === 429 || res.status === 418) && _retries > 0) {
        const retryAfter = res.headers.get('Retry-After')
        const baseDelay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 2000
        const delay = baseDelay * Math.pow(2, 3 - _retries) + Math.random() * 500 // jitter
        console.warn(`[BinanceClient] ${res.status} rate limited, retrying in ${Math.round(delay)}ms (${_retries} left)`) 
        await new Promise(r => setTimeout(r, delay))
        return this.request(method, path, params, _retries - 1)
      }

      throw new Error(msg)
    }

    return res.json()
  }

  // ─── Account ────────────────────────────────────────────────────────────────

  /** Get account info including all balances */
  async getAccountInfo(): Promise<any> {
    return this.request('GET', '/api/v3/account')
  }

  /** Get all coin balances with non-zero holdings */
  async getAllBalances(): Promise<{ totalEquityUsdt: number; coins: CoinBalance[]; accountType: string }> {
    try {
      const account = await this.getAccountInfo()
      const balances: CoinBalance[] = (account.balances || [])
        .filter((b: any) => Number(b.free) > 0 || Number(b.locked) > 0)
        .map((b: any) => ({
          coin: b.asset,
          equity: (Number(b.free) + Number(b.locked)).toString(),
          available: b.free,
          locked: b.locked,
          walletBalance: (Number(b.free) + Number(b.locked)).toString(),
          free: b.free,
        }))

      // Calculate total equity in USDT by converting all coin balances
      let totalEquityUsdt = 0
      try {
        // Fetch all USDT ticker prices at once
        const priceRes = await fetch(`${this.baseUrl}/api/v3/ticker/price`, {
          signal: AbortSignal.timeout(10000),
        })
        const allPrices: Array<{ symbol: string; price: string }> = priceRes.ok ? await priceRes.json() : []
        const priceMap = new Map(allPrices.map(p => [p.symbol, parseFloat(p.price)]))

        for (const b of balances) {
          const qty = Number(b.equity)
          if (qty <= 0) continue

          if (b.coin === 'USDT') {
            totalEquityUsdt += qty
          } else {
            // Try COINUSDT pair first, then COINBTC
            const usdtPrice = priceMap.get(`${b.coin}USDT`)
            if (usdtPrice) {
              totalEquityUsdt += qty * usdtPrice
            } else {
              const btcPrice = priceMap.get(`${b.coin}BTC`)
              const btcUsdt = priceMap.get('BTCUSDT')
              if (btcPrice && btcUsdt) {
                totalEquityUsdt += qty * btcPrice * btcUsdt
              }
              // If no pair found, value is ~0 — skip
            }
          }
        }
      } catch {
        // Fallback: only count USDT if price fetch fails
        const usdtBalance = balances.find(b => b.coin === 'USDT')
        totalEquityUsdt = Number(usdtBalance?.walletBalance || 0)
      }

      return {
        totalEquityUsdt: parseFloat(totalEquityUsdt.toFixed(2)),
        coins: balances,
        accountType: 'spot',
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Błąd pobierania salda Binance'
      throw new Error(msg)
    }
  }

  /** Test API key validity by fetching account info */
  async testConnection(): Promise<{ success: boolean; message: string; balance?: number }> {
    try {
      const result = await this.getAllBalances()
      return {
        success: true,
        message: `Połączono z Binance (${this.config.mode}). Wartość portfela: $${result.totalEquityUsdt.toFixed(2)}`,
        balance: result.totalEquityUsdt,
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Błąd połączenia z Binance'
      return {
        success: false,
        message: errMsg,
      }
    }
  }

  // ─── Orders ─────────────────────────────────────────────────────────────────

  /** Place a market sell order (spot) */
  async marketSell(symbol: string, quantity: string, _orderLinkId?: string): Promise<OrderResult> {
    const params: Record<string, unknown> = {
      symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity,
    }

    const response = await this.request('POST', '/api/v3/order', params)

    return {
      orderId: String(response.orderId || ''),
      orderLinkId: String(response.clientOrderId || ''),
      price: String(response.price || '0'),
      quantity: String(response.origQty || quantity),
      amount: String(response.cummulativeQuoteQty || '0'),
      dealQuantity: String(response.executedQty || '0'),
      dealAmount: String(response.cummulativeQuoteQty || '0'),
      side: 'Sell',
      type: 'Market',
      status: String(response.status || 'NEW'),
      createTime: Number(response.transactTime || Date.now()),
      avgPrice: String(response.price || '0'),
    }
  }

  /** Place a limit sell order (for TP) */
  async limitSell(symbol: string, quantity: string, price: string): Promise<OrderResult> {
    const params: Record<string, unknown> = {
      symbol,
      side: 'SELL',
      type: 'LIMIT',
      quantity,
      price,
      timeInForce: 'GTC',
    }

    const response = await this.request('POST', '/api/v3/order', params)

    return {
      orderId: String(response.orderId || ''),
      orderLinkId: String(response.clientOrderId || ''),
      price: String(response.price || price),
      quantity: String(response.origQty || quantity),
      amount: String(response.cummulativeQuoteQty || '0'),
      dealQuantity: String(response.executedQty || '0'),
      dealAmount: String(response.cummulativeQuoteQty || '0'),
      side: 'Sell',
      type: 'Limit',
      status: String(response.status || 'NEW'),
      createTime: Number(response.transactTime || Date.now()),
      avgPrice: String(response.price || price),
    }
  }

  /** Place a market buy order using quoteOrderQty (USDT amount) */
  async marketBuy(symbol: string, quoteOrderQty: string): Promise<OrderResult> {
    const params: Record<string, unknown> = {
      symbol,
      side: 'BUY',
      type: 'MARKET',
      quoteOrderQty,
    }

    const response = await this.request('POST', '/api/v3/order', params)

    return {
      orderId: String(response.orderId || ''),
      orderLinkId: String(response.clientOrderId || ''),
      price: String(response.price || '0'),
      quantity: String(response.origQty || '0'),
      amount: String(response.cummulativeQuoteQty || quoteOrderQty),
      dealQuantity: String(response.executedQty || '0'),
      dealAmount: String(response.cummulativeQuoteQty || '0'),
      side: 'Buy',
      type: 'Market',
      status: String(response.status || 'NEW'),
      createTime: Number(response.transactTime || Date.now()),
      avgPrice: String(response.fills?.[0]?.price || response.price || '0'),
    }
  }

  /** Place a limit buy order */
  async limitBuy(symbol: string, quantity: string, price: string): Promise<OrderResult> {
    const params: Record<string, unknown> = {
      symbol,
      side: 'BUY',
      type: 'LIMIT',
      quantity,
      price,
      timeInForce: 'GTC',
    }

    const response = await this.request('POST', '/api/v3/order', params)

    return {
      orderId: String(response.orderId || ''),
      orderLinkId: String(response.clientOrderId || ''),
      price: String(response.price || price),
      quantity: String(response.origQty || quantity),
      amount: String(response.cummulativeQuoteQty || '0'),
      dealQuantity: String(response.executedQty || '0'),
      dealAmount: String(response.cummulativeQuoteQty || '0'),
      side: 'Buy',
      type: 'Limit',
      status: String(response.status || 'NEW'),
      createTime: Number(response.transactTime || Date.now()),
      avgPrice: String(response.price || price),
    }
  }

  /** Get coin balance for a specific asset */
  async getCoinBalance(coin: string): Promise<CoinBalance | null> {
    const account = await this.getAccountInfo()
    const b = (account.balances || []).find((b: any) => b.asset === coin)
    if (!b) return null
    return {
      coin: b.asset,
      equity: (Number(b.free) + Number(b.locked)).toString(),
      available: b.free,
      locked: b.locked,
      walletBalance: (Number(b.free) + Number(b.locked)).toString(),
      free: b.free,
    }
  }

  // ─── Open Orders ────────────────────────────────────────────────────────────

  /** Get open (active) orders. If symbol is provided, filters by symbol. */
  async getOpenOrders(symbol?: string): Promise<BinanceOpenOrder[]> {
    const params: Record<string, unknown> = {}
    if (symbol) params.symbol = symbol
    const response = await this.request('GET', '/api/v3/openOrders', params)
    return (Array.isArray(response) ? response : []).map((o: any) => ({
      symbol: String(o.symbol || ''),
      orderId: String(o.orderId || ''),
      clientOrderId: String(o.clientOrderId || ''),
      price: String(o.price || '0'),
      origQty: String(o.origQty || '0'),
      executedQty: String(o.executedQty || '0'),
      cummulativeQuoteQty: String(o.cummulativeQuoteQty || '0'),
      status: String(o.status || 'NEW'),
      type: String(o.type || 'LIMIT'),
      side: String(o.side || 'BUY'),
      time: Number(o.time || 0),
      updateTime: Number(o.updateTime || 0),
      timeInForce: String(o.timeInForce || 'GTC'),
    }))
  }

  /** Cancel an open order by symbol + orderId */
  async cancelOrder(symbol: string, orderId: string): Promise<any> {
    return this.request('DELETE', '/api/v3/order', { symbol, orderId })
  }

  // ─── Market Data ────────────────────────────────────────────────────────────

  /** Get ticker price for a symbol */
  async getTickerPrice(symbol: string): Promise<number> {
    const response = await this.request('GET', '/api/v3/ticker/price', { symbol })
    return Number(response.price || 0)
  }

  /** Get exchange info for a symbol (filters, lot size, min notional) */
  async getSymbolInfo(symbol: string): Promise<any> {
    const response = await this.request('GET', '/api/v3/exchangeInfo', { symbol })
    return response.symbols?.[0] || null
  }

  /** Get order book depth (public, no auth required) */
  async getOrderBook(symbol: string, limit = 20): Promise<OrderBookData> {
    const url = `${this.baseUrl}/api/v3/depth?symbol=${symbol}&limit=${limit}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) {
      const errData = await res.json().catch(() => ({})) as any
      throw new Error(errData?.msg || `Binance depth error: ${res.status}`)
    }
    const data = await res.json()
    const bids: OrderBookEntry[] = (data.bids || []).map(([price, qty]: [string, string]) => ({
      price: Number(price),
      quantity: Number(qty),
      total: Number(price) * Number(qty),
    }))
    const asks: OrderBookEntry[] = (data.asks || []).map(([price, qty]: [string, string]) => ({
      price: Number(price),
      quantity: Number(qty),
      total: Number(price) * Number(qty),
    }))
    return { bids, asks, lastUpdateId: Number(data.lastUpdateId || 0) }
  }
}

// ─── Helper: Create BinanceClient from stored DB keys ──────────────────────────

export async function createBinanceClient(mode: BinanceMode): Promise<BinanceClient> {
  void mode
  throw new Error('Handel przez Binance został wyłączony. Publiczne dane rynkowe Binance pozostają dostępne.')
}
