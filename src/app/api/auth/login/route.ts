import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  AUTH_COOKIE_NAME,
  createSessionToken,
} from '@/lib/auth'

function matchesSecret(candidate: string, expected: string): boolean {
  const candidateBytes = Buffer.from(candidate)
  const expectedBytes = Buffer.from(expected)
  return candidateBytes.length === expectedBytes.length
    && timingSafeEqual(candidateBytes, expectedBytes)
}

export async function POST(request: Request) {
  const configuredKey = process.env.BRRR_API_KEY
  if (!configuredKey) {
    return NextResponse.json(
      { error: 'BRRR_API_KEY nie jest skonfigurowany on serwerze.' },
      { status: 503 },
    )
  }

  const body = await request.json().catch(() => null)
  const apiKey = typeof body?.apiKey === 'string' ? body.apiKey : ''
  if (!matchesSecret(apiKey, configuredKey)) {
    return NextResponse.json(
      { error: 'Invalid access key.' },
      { status: 401 },
    )
  }

  const response = NextResponse.json({ success: true })
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const secureCookie =
    forwardedProto === 'https' || new URL(request.url).protocol === 'https:'
  response.cookies.set(
    AUTH_COOKIE_NAME,
    await createSessionToken(configuredKey),
    {
      httpOnly: true,
      secure: secureCookie,
      sameSite: 'strict',
      path: '/',
      maxAge: AUTH_COOKIE_MAX_AGE_SECONDS,
    },
  )
  return response
}
