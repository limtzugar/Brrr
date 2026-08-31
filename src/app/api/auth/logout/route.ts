import { NextResponse } from 'next/server'
import { AUTH_COOKIE_NAME } from '@/lib/auth'

export async function POST(request: Request) {
  const response = NextResponse.json({ success: true })
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const secureCookie =
    forwardedProto === 'https' || new URL(request.url).protocol === 'https:'
  response.cookies.set(AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    secure: secureCookie,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  })
  return response
}
