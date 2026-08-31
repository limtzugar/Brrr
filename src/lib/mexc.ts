// ─── MEXC V3 REST API Client ────────────────────────────────────────────────
// Supports spot trading with HMAC-SHA256 authentication.
// MEXC Fee Structure: Maker 0.0000%, Taker 0.0500%

import { createHmac } from 'crypto'

// ─── Configuration ──────────────────────────────────────────────────────────

const BASE_URLS = {
  demo: 'https://api.mexc.com', // MEXC has no separate testnet — same URL, test keys
  real: 'https://api.mexc.com',
} as const

export type MexcMode = 'demo' | 'real'

interface MexcConfig {
  apiKey: string
  apiSecret: string
  mode: MexcMode
}

// ─── Fee Structure ──────────────────────────────────────────────────────────

export const MEXC_FEES = {
  maker: 0.0,      // 0.0000% — zero maker fee
  taker: 0.05,     // 0.0500%
  /** Default fee for backtest/strategy: average of maker+taker = 0.025% */
  default: 0.025,  // average for backtest estimation
} as const

// ─── Types ──────────────────────────────────────────────────────────────────

interface MexcResponse {
  code: number
  msg: string
  data: unknown
}

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

// ─── CoinGecko ID → MEXC Symbol Mapping ────────────────────────────────────

export const COIN_TO_MEXC: Record<string, string> = {
  bitcoin: 'BTCUSDT',
  ethereum: 'ETHUSDT',
  solana: 'SOLUSDT',
  binancecoin: 'BNBUSDT',
  ripple: 'XRPUSDT',
  cardano: 'ADAUSDT',
  dogecoin: 'DOGEUSDT',
  polkadot: 'DOTUSDT',
  'avalanche-2': 'AVAXUSDT',
  chainlink: 'LINKUSDT',
  'shiba-inu': 'SHIBUSDT',
  litecoin: 'LTCUSDT',
  uniswap: 'UNIUSDT',
  stellar: 'XLMUSDT',
  'polygon-pos': 'MATICUSDT',
  arbitrum: 'ARBUSDT',
  optimism: 'OPUSDT',
  near: 'NEARUSDT',
  aptos: 'APTUSDT',
  sui: 'SUIUSDT',
  pepe: 'PEPEUSDT',
  render: 'RENDERUSDT',
  injective: 'INJUSDT',
  cosmos: 'ATOMUSDT',
  hyperliquid: 'HYPEUSDT',
}

export function getMexcSymbol(coinId: string): string {
  return COIN_TO_MEXC[coinId] || coinId.toUpperCase() + 'USDT'
}

// ─── Authentication ─────────────────────────────────────────────────────────

/**
 * MEXC V3 API signature: HMAC-SHA256 of the query string or body.
 * Parameters must be sorted alphabetically for GET requests.
 */
function generateSignature(params: string, apiSecret: string): string {
  return createHmac('sha256', apiSecret).update(params).digest('hex')
}

function buildQueryString(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

// ─── API Client Class ───────────────────────────────────────────────────────

export class MexcClient {
  private config: MexcConfig
  private baseUrl: string
  private recvWindow: number = 5000

  constructor(config: MexcConfig) {
    this.config = {
      apiKey: config.apiKey.trim(),
      apiSecret: config.apiSecret.trim(),
      mode: config.mode,
    }
    this.baseUrl = BASE_URLS[config.mode]
  }

  private async request(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}): Promise<MexcResponse> {
    const timestamp = Date.now()
    params.timestamp = timestamp
    params.recvWindow = this.recvWindow

    let url: string
    let headers: Record<string, string> = {
      'X-MEXC-APIKEY': this.config.apiKey,
    }

    if (method === 'GET' || method === 'DELETE') {
      const qs = buildQueryString(params)
      const signature = generateSignature(qs, this.config.apiSecret)
      url = `${this.baseUrl}${path}?${qs}&signature=${signature}`
    } else {
      // POST: body as JSON with signature
      const body = JSON.stringify(params)
      const signature = generateSignature(body, this.config.apiSecret)
      url = `${this.baseUrl}${path}`
      headers['Content-Type'] = 'application/json'
      headers['signature'] = signature
    }

    try {
      const res = await fetch(url, {
        method,
        headers,
        signal: AbortSignal.timeout(15000),
      })

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`MEXC API error: ${res.status} ${res.statusText} ${text}`)
      }

      const json = await res.json()

      // MEXC V3 uses different response formats
      // Some endpoints return { code, msg, data }, others return direct data
      if (json.code !== undefined && json.code !== 0 && json.code !== 200) {
        throw new Error(`MEXC API error: ${json.msg || json.code} (code: ${json.code})`)
      }

      return json
    } catch (err) {
      if (err instanceof Error && err.message.includes('MEXC')) throw err
      throw new Error(`MEXC request failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // ─── Account ────────────────────────────────────────────────────────────────

  /** Get all account balances */
  async getAllBalances(): Promise<{ totalEquityUsdt: number; coins: CoinBalance[] }> {
    try {
      // MEXC V3 spot account endpoint
      const response = await this.request('GET', '/api/v3/account')

      // MEXC returns balances as array of { asset, free, locked }
      let balances: Array<{ asset: string; free: string; locked: string }> = []

      if (Array.isArray(response)) {
        balances = response
      } else {
        const data = (response as unknown as Record<string, unknown>).data || (response as unknown as Record<string, unknown>)
        if (Array.isArray(data)) {
          balances = data
        } else if (typeof data === 'object' && data !== null) {
          const balancesField = (data as Record<string, unknown>).balances
          if (Array.isArray(balancesField)) {
            balances = balancesField
          }
        }
      }

      const coins: CoinBalance[] = balances
        .filter(b => Number(b.free) > 0 || Number(b.locked) > 0)
        .map(b => ({
          coin: b.asset,
          equity: (Number(b.free) + Number(b.locked)).toString(),
          available: b.free,
          locked: b.locked,
          walletBalance: (Number(b.free) + Number(b.locked)).toString(),
          free: b.free,
        }))

      const totalEquityUsdt = coins.reduce((sum, c) => {
        // Only count USDT directly; other coins would need price conversion
        if (c.coin === 'USDT') return sum + Number(c.equity)
        return sum
      }, 0)

      return { totalEquityUsdt, coins }
    } catch (err) {
      console.error('[MEXC] getAllBalances error:', err)
      return { totalEquityUsdt: 0, coins: [] }
    }
  }

  /** Test API key validity by fetching account info */
  async testConnection(): Promise<{ success: boolean; message: string; balance?: number }> {
    try {
      const { totalEquityUsdt, coins } = await this.getAllBalances()
      const usdtCoin = coins.find(c => c.coin === 'USDT')
      const usdtBalance = usdtCoin ? Number(usdtCoin.free) : totalEquityUsdt

      return {
        success: true,
        message: `Połączono of MEXC${this.config.mode === 'demo' ? ' (Demo)' : ''}. Saldo USDT: ${usdtBalance.toFixed(2)}`,
        balance: usdtBalance,
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'MEXC connection error'
      if (errMsg.includes('Invalid') || errMsg.includes('signature') || errMsg.includes('apikey')) {
        return {
          success: false,
          message: `MEXC authorization error. Check if API key and secret are correct. Details: ${errMsg}`,
        }
      }
      return {
        success: false,
        message: errMsg,
      }
    }
  }

  // ─── Market Data ────────────────────────────────────────────────────────────

  /** Get ticker for a symbol (no auth required) */
  async getTicker(symbol: string): Promise<{ lastPrice: string; highPrice24h: string; lowPrice24h: string; volume24h: string }> {
    const url = `${this.baseUrl}/api/v3/ticker/24hr?symbol=${symbol}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) throw new Error(`MEXC ticker error: ${res.status}`)
    const json = await res.json()
    return {
      lastPrice: json.lastPrice || json.price || '0',
      highPrice24h: json.highPrice || '0',
      lowPrice24h: json.lowPrice || '0',
      volume24h: json.volume || '0',
    }
  }

  // ─── Orders ─────────────────────────────────────────────────────────────────

  /** Place a market buy order (spot) */
  async marketBuy(symbol: string, quantity: string, quoteOrderQty?: string): Promise<OrderResult> {
    const params: Record<string, unknown> = {
      symbol,
      side: 'BUY',
      type: 'MARKET',
    }
    // For MARKET orders, MEXC uses quantity (base) or quoteOrderQty (quote)
    if (quoteOrderQty) {
      params.quoteOrderQty = quoteOrderQty
    } else {
      params.quantity = quantity
    }

    const response = await this.request('POST', '/api/v3/order', params)
    const raw = (response as unknown as Record<string, unknown>).data || response
    const d = raw as Record<string, unknown>

    return {
      orderId: String(d.id || d.orderId || ''),
      orderLinkId: String(d.clientOrderId || ''),
      price: String(d.price || '0'),
      quantity: String(d.origQty || d.quantity || quantity),
      amount: String(d.cummulativeQuoteQty || d.amount || '0'),
      dealQuantity: String(d.executedQty || d.dealQuantity || '0'),
      dealAmount: String(d.cummulativeQuoteQty || d.dealAmount || '0'),
      side: 'Buy',
      type: 'Market',
      status: String(d.status || 'NEW'),
      createTime: Number(d.transactTime || d.createTime || Date.now()),
      avgPrice: String(d.price || '0'),
    }
  }

  /** Place a market sell order (spot) */
  async marketSell(symbol: string, quantity: string, _orderLinkId?: string): Promise<OrderResult> {
    const params: Record<string, unknown> = {
      symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity,
    }

    const response = await this.request('POST', '/api/v3/order', params)
    const raw = (response as unknown as Record<string, unknown>).data || response
    const d = raw as Record<string, unknown>

    return {
      orderId: String(d.id || d.orderId || ''),
      orderLinkId: String(d.clientOrderId || ''),
      price: String(d.price || '0'),
      quantity: String(d.origQty || d.quantity || quantity),
      amount: String(d.cummulativeQuoteQty || d.amount || '0'),
      dealQuantity: String(d.executedQty || d.dealQuantity || '0'),
      dealAmount: String(d.cummulativeQuoteQty || d.dealAmount || '0'),
      side: 'Sell',
      type: 'Market',
      status: String(d.status || 'NEW'),
      createTime: Number(d.transactTime || d.createTime || Date.now()),
      avgPrice: String(d.price || '0'),
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
    const raw = (response as unknown as Record<string, unknown>).data || response
    const d = raw as Record<string, unknown>

    return {
      orderId: String(d.id || d.orderId || ''),
      orderLinkId: String(d.clientOrderId || ''),
      price: String(d.price || price),
      quantity: String(d.origQty || d.quantity || quantity),
      amount: String(d.cummulativeQuoteQty || d.amount || '0'),
      dealQuantity: String(d.executedQty || d.dealQuantity || '0'),
      dealAmount: String(d.cummulativeQuoteQty || d.dealAmount || '0'),
      side: 'Sell',
      type: 'Limit',
      status: String(d.status || 'NEW'),
      createTime: Number(d.transactTime || d.createTime || Date.now()),
      avgPrice: String(d.price || price),
    }
  }

  /** Cancel an order */
  async cancelOrder(symbol: string, orderId: string): Promise<void> {
    await this.request('DELETE', '/api/v3/order', { symbol, orderId })
  }

  /** Get open orders for a symbol */
  async getOpenOrders(symbol: string): Promise<Array<{ orderId: string; side: string; type: string; price: string; quantity: string; status: string }>> {
    const response = await this.request('GET', '/api/v3/openOrders', { symbol })

    if (Array.isArray(response)) {
      return response
    }
    if (response.data && Array.isArray(response.data)) {
      return response.data
    }
    return []
  }

  /** Get order history */
  async getOrderHistory(symbol: string, limit: number = 5): Promise<Array<{ orderId: string; side: string; orderType: string; price: string; avgPrice: string; qty: string; cumExecQty: string; orderStatus: string; createdTime: string }>> {
    const response = await this.request('GET', '/api/v3/allOrders', { symbol, limit })

    let rawList: Array<Record<string, unknown>> = []
    if (Array.isArray(response)) {
      rawList = response
    } else {
      const data = (response as unknown as Record<string, unknown>).data
      if (Array.isArray(data)) rawList = data
    }

    return rawList.map(o => ({
      orderId: String(o.id || o.orderId || ''),
      side: String(o.side || ''),
      orderType: String(o.type || ''),
      price: String(o.price || '0'),
      avgPrice: String(o.price || '0'),
      qty: String(o.origQty || o.quantity || '0'),
      cumExecQty: String(o.executedQty || o.dealQuantity || '0'),
      orderStatus: String(o.status || ''),
      createdTime: String(o.time || o.createTime || ''),
    }))
  }

  // ─── Spot Asset Balance ─────────────────────────────────────────────────────

  /** Get coin balance for spot trading */
  async getCoinBalance(coin: string): Promise<number> {
    const { coins } = await this.getAllBalances()
    const found = coins.find(c => c.coin === coin)
    return found ? Number(found.free) : 0
  }
}

// ─── Helper: Create MexcClient from stored DB keys ──────────────────────────

export async function createMexcClient(mode: MexcMode): Promise<MexcClient> {
  const { db } = await import('./db')
  const { decrypt } = await import('./encryption')

  const api = await db.exchangeApi.findUnique({
    where: { exchange_mode: { exchange: 'mexc', mode } },
  })

  if (!api || !api.isConfigured) {
    throw new Error(`Klucze API MEXC (${mode}) nie są skonfigurowane`)
  }

  return new MexcClient({
    apiKey: decrypt(api.apiKey),
    apiSecret: decrypt(api.apiSecret),
    mode,
  })
}

// ─── Exchange Fee Info Helper ───────────────────────────────────────────────

export function getExchangeFees(exchange: string): { maker: number; taker: number; default: number } {
  if (exchange === 'mexc') return { ...MEXC_FEES }
  // Bybit default: 0.1% maker, 0.1% taker (VIP0)
  return { maker: 0.1, taker: 0.1, default: 0.1 }
}
