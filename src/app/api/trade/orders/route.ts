import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const removed = () => NextResponse.json(
  { error: 'Trading via Binance has been disabled' },
  { status: 410 }
)

export async function GET() {
  return removed()
}

export async function DELETE() {
  return removed()
}
