// ─── AES-256-GCM Encryption for API Keys ──────────────────────────────────────
// Uses a server-side secret from ENCRYPTION_KEY env var (or fallback for dev).
// API keys are never stored in plaintext.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // NIST SP 800-38D recommended 12-byte IV for GCM (hardware accelerated)
const AUTH_TAG_LENGTH = 16

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'ENCRYPTION_KEY env var not set — refusing to encrypt/decrypt in production. ' +
        'Set it in .env; API keys stored with the dev key must be re-entered.'
      )
    }
    console.warn('[ENCRYPTION] ENCRYPTION_KEY not set — using INSECURE dev key (development only)')
  }
  const keySource = secret || 'trading-dev-key-change-in-production-32ch'
  // Per-deployment salt: ENCRYPTION_SALT env var, else deterministic but isolated per ENCRYPTION_KEY
  // Previously hardcoded 'trading-salt' meant every install with same ENCRYPTION_KEY derived same AES key.
  const salt = process.env.ENCRYPTION_SALT || `brrr-${keySource.slice(0, 8)}-salt`
  return scryptSync(keySource, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 })
}

export function encrypt(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  // Format: iv:authTag:encrypted (all base64)
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
}

export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey()
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted format')

  const iv = Buffer.from(parts[0], 'base64')
  const authTag = Buffer.from(parts[1], 'base64')
  const encrypted = Buffer.from(parts[2], 'base64')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}

/** Mask an API key for display: show first 4 and last 4 chars */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****'
  return key.slice(0, 4) + '*'.repeat(key.length - 8) + key.slice(-4)
}
