import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoDir = path.resolve(scriptDir, '..')
const port = 3005

process.chdir(repoDir)

// Standalone Next.js does not load the repository .env automatically.
// Load it before importing the generated server, without printing secrets.
const envPath = path.join(repoDir, '.env')
if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const name = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[name] === undefined) process.env[name] = value
  }
}

process.env.PORT = String(port)
process.env.HOSTNAME = '0.0.0.0'
process.env.NODE_ENV = 'production'

async function portIsAvailable() {
  return new Promise(resolve => {
    const probe = net.createServer()
    probe.once('error', error => {
      resolve(error?.code !== 'EADDRINUSE')
    })
    probe.once('listening', () => {
      probe.close(() => resolve(true))
    })
    probe.listen(port, '0.0.0.0')
  })
}

if (!await portIsAvailable()) {
  console.log(`[BRRR] Port ${port} is already in use; startup skipped.`)
} else {
  const serverPath = path.join(repoDir, '.next', 'standalone', 'server.js')
  if (!fs.existsSync(serverPath)) {
    throw new Error(
      `Production build missing at ${serverPath}. Run npm run build first.`,
    )
  }
  await import(pathToFileURL(serverPath).href)
}
