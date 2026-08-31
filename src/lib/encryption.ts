// ─── AES-256-GCM Encryption for API Keys ──────────────────────────────────────
// Uses a server-side secret from ENCRYPTION_KEY env var (or fallback for dev).
// API keys are never stored in plaintext.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      // SECURITY: fail closed — the hardcoded dev key lets anyone with the source
      // decrypt exchange API keys from the database.
      // NOTE: keys previously stored with the dev key must be RE-ENTERED after
      // setting ENCRYPTION_KEY (they are not migratable by design).
      throw new Error(
        'ENCRYPTION_KEY env var not set — refusing to encrypt/decrypt in production. ' +
        'Set it in .env; API keys stored with the dev key must be re-entered.'
      )
    }
    console.warn('[ENCRYPTION] ENCRYPTION_KEY not set — using INSECURE dev key (development only)')
  }
  const keySource = secret || 'trading-dev-key-change-in-production-32ch'
  return scryptSync(keySource, 'trading-salt', 32)
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
