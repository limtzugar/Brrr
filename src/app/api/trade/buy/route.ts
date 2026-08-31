import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    { error: 'Trading via Binance has been disabled' },
    { status: 410 }
  )
}
