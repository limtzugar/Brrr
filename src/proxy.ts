import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME, createSessionToken } from '@/lib/auth'
import { checkRateLimitAsync } from '@/lib/rate-limit'

const API_KEY = process.env.BRRR_API_KEY
const AUTH_DISABLED_IN_DEVELOPMENT =
  !API_KEY && process.env.NODE_ENV !== 'production'
// SECURITY: no hardcoded fallback — cron endpoints stay disabled unless CRON_SECRET is set
const CRON_SECRET = process.env.CRON_SECRET

const PUBLIC_PATHS = new Set(['/login', '/api/auth/login'])

const RATE_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  '/api/auth/login': { limit: 5, windowMs: 15 * 60_000 },
  '/api/backtest/optimize': { limit: 5, windowMs: 60000 },
  '/api/backtest/bulk': { limit: 10, windowMs: 60000 },
  '/api/backtest/bulk-klines': { limit: 20, windowMs: 60000 },
  '/api/sell-all': { limit: 5, windowMs: 60000 },
  '/api/panic-sell': { limit: 3, windowMs: 60000 },
  '/api/exchange': { limit: 30, windowMs: 60000 },
  '/api/strategies/activate': { limit: 10, windowMs: 60000 },
  '/api/strategies/deactivate': { limit: 10, windowMs: 60000 },
  '/api/trade/buy': { limit: 20, windowMs: 60000 },
  '/api/trade/market-buy': { limit: 20, windowMs: 60000 },
  '/api/sell': { limit: 10, windowMs: 60000 },
  '/api/transfer': { limit: 10, windowMs: 60000 },
  '/api/bybit/futures/open': { limit: 10, windowMs: 60000 },
  '/api/bybit/futures/close': { limit: 10, windowMs: 60000 },
  '/api/bybit/futures/trading-stop': { limit: 20, windowMs: 60000 },
  '/api/bybit/futures/switch-isolated': { limit: 20, windowMs: 60000 },
  '/api/settings': { limit: 30, windowMs: 60000 },
  default: { limit: 60, windowMs: 60000 },
}

function getClientIp(request: NextRequest): string {
  // Trust x-real-ip (set by Caddy: header_up X-Real-IP {remote_host}) first.
  // x-forwarded-for can be spoofed by clients (Caddy appends but doesn't strip prepended values),
  // so we take the LAST entry (closest proxy) not the first. Fallback to unknown.
  const realIp = request.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean)
    return parts[parts.length - 1] || 'unknown'
  }
  return 'unknown'
}

async function checkAuth(request: NextRequest): Promise<boolean> {
  if (AUTH_DISABLED_IN_DEVELOPMENT) return true
  if (!API_KEY) return false

  const headerKey = request.headers.get('x-api-key')
  if (headerKey === API_KEY) return true

  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ') && authHeader.slice(7) === API_KEY) {
    return true
  }

  const sessionCookie = request.cookies.get(AUTH_COOKIE_NAME)?.value
  if (!sessionCookie) return false

  return sessionCookie === await createSessionToken(API_KEY)
}

function unauthorized(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'Unauthorized. Sign in or provide a valid API key.' },
      {
        status: 401,
        headers: { 'WWW-Authenticate': 'Bearer realm="brrr-api"' },
      },
    )
  }

  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.searchParams.set('next', request.nextUrl.pathname)
  return NextResponse.redirect(loginUrl)
}

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const isCronPath = path.startsWith('/api/cron/')
  if (isCronPath && !CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET env var not set — cron endpoints disabled' },
      { status: 503 },
    )
  }
  // SECURITY: only x-cron-secret header — token in URL leaks to access logs / proxy logs
  const isAuthorizedCron = isCronPath
    && request.headers.get('x-cron-secret') === CRON_SECRET

  // Internal schedulers authenticate with a dedicated secret and must not need
  // an interactive BRRR session cookie or the general API key.
  if (isAuthorizedCron) return NextResponse.next()

  if (!API_KEY && process.env.NODE_ENV === 'production') {
    if (path === '/login') return NextResponse.next()
    if (path.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Server authentication is not configured.' },
        { status: 503 },
      )
    }
    return unauthorized(request)
  }

  const ip = getClientIp(request)
  const rateConfig = RATE_LIMITS[path] || RATE_LIMITS.default

  if (path.startsWith('/api/')) {
    // Async variant — the sync wrapper silently allows everything when the
    // configured backend is async (redis/file), disabling all per-route limits.
    const rateResult = await checkRateLimitAsync(
      `proxy:${path}:${ip}`,
      rateConfig.limit,
      rateConfig.windowMs,
    )
    if (!rateResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests.' },
        {
          status: 429,
          headers: {
            'X-RateLimit-Limit': String(rateConfig.limit),
            'X-RateLimit-Remaining': String(rateResult.remaining),
            'X-RateLimit-Reset': String(Date.now() + rateConfig.windowMs),
          },
        },
      )
    }
  }

  if (!PUBLIC_PATHS.has(path) && !await checkAuth(request)) {
    return unauthorized(request)
  }

  if (path === '/login' && await checkAuth(request)) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  const res = NextResponse.next()
  // Security headers (also set in Caddyfile, but defense in depth for direct Next access)
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  return res
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|brrr-logo.svg|fonts/).*)',
  ],
}
