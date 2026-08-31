import { NextResponse } from 'next/server'
import { resumeActiveStrategies } from '@/lib/strategy-runner'
import { resumeStrategyLearningJobs } from '@/lib/strategy-shadow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  // SECURITY: no hardcoded fallback — route disabled unless CRON_SECRET is set
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET env var not set — trading-runtime disabled' }, { status: 503 })
  }
  const token = request.headers.get('x-cron-secret')
    || new URL(request.url).searchParams.get('token')
  if (token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await resumeStrategyLearningJobs()
    await resumeActiveStrategies()
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Runtime recovery failed',
    }, { status: 500 })
  }
}
