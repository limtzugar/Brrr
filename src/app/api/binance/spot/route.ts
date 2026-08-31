import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const removed = () => NextResponse.json(
  { error: 'Handel przez Binance został wyłączony' },
  { status: 410 }
)

export async function GET() {
  return removed()
}

export async function POST() {
  return removed()
}
