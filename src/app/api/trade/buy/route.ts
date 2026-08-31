import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST() {
  return NextResponse.json(
    { error: 'Handel przez Binance został wyłączony' },
    { status: 410 }
  )
}
