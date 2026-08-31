import { execSync } from 'child_process'
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { NextRequest, NextResponse } from 'next/server'

const CRON_SECRET = process.env.CRON_SECRET
const MAX_BACKUPS = 6
const PROJECT_DIR = process.env.PROJECT_DIR || process.cwd()
const BACKUP_DIR = process.env.BACKUP_DIR || `${PROJECT_DIR}/upload`
const LOG_FILE = process.env.BACKUP_LOG_FILE || `${PROJECT_DIR}/backup-log.txt`

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') || req.headers.get('x-cron-secret') || ''
  if (!CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET env var not set — recovery point disabled' }, { status: 503 })
  if (token !== CRON_SECRET) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const startedAt = new Date().toISOString()
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
  const filename = `brrr-auto-${timestamp}.tar.gz`
  const filepath = `${BACKUP_DIR}/${filename}`

  try {
    if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true })
    execSync(`tar --exclude=node_modules --exclude=.next --exclude=.git --exclude=upload --exclude=download --exclude=*.pyc --exclude=__pycache__ -czf ${filepath} -C ${PROJECT_DIR} .`, { timeout: 120_000, stdio: 'pipe' })
    appendFileSync(LOG_FILE, `[${startedAt}] BACKUP DONE → ${filename}\n`)
    const backups = readdirSync(BACKUP_DIR).filter(n => n.startsWith('brrr-auto-')).map(name => ({ name, mtime: statSync(`${BACKUP_DIR}/${name}`).mtimeMs })).sort((a, b) => b.mtime - a.mtime)
    const toDelete = backups.slice(MAX_BACKUPS)
    for (const old of toDelete) { try { unlinkSync(`${BACKUP_DIR}/${old.name}`) } catch {} }
    return NextResponse.json({ success: true, filename, remaining: backups.length - toDelete.length, timestamp: new Date().toISOString() })
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    try { appendFileSync(LOG_FILE, `[${startedAt}] BACKUP FAILED → ${errMsg}\n`) } catch {}
    return NextResponse.json({ success: false, error: errMsg, timestamp: new Date().toISOString() }, { status: 500 })
  }
}
