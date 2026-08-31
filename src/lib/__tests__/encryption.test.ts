// ─── Encryption tests ───────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest'
import { encrypt, decrypt, maskApiKey } from '../encryption'

describe('Encryption', () => {
  it('encrypts and decrypts a string correctly', () => {
    const original = 'my-secret-api-key-12345'
    const encrypted = encrypt(original)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(original)
  })

  it('produces different ciphertexts for same plaintext (random IV)', () => {
    const original = 'same-input'
    const encrypted1 = encrypt(original)
    const encrypted2 = encrypt(original)
    expect(encrypted1).not.toBe(encrypted2) // Different IVs → different ciphertext
  })

  it('produces ciphertext in iv:authTag:encrypted format', () => {
    const encrypted = encrypt('test')
    const parts = encrypted.split(':')
    expect(parts).toHaveLength(3)
    // Each part should be valid base64
    for (const part of parts) {
      expect(() => Buffer.from(part, 'base64')).not.toThrow()
    }
  })

  it('handles empty string', () => {
    const encrypted = encrypt('')
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe('')
  })

  it('handles unicode characters', () => {
    const original = 'klucz-api-zażółć-gęślą'
    const encrypted = encrypt(original)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(original)
  })

  it('throws on invalid format for decrypt', () => {
    expect(() => decrypt('invalid')).toThrow('Invalid encrypted format')
    expect(() => decrypt('a:b:c:d')).toThrow('Invalid encrypted format')
  })

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt('secret')
    const parts = encrypted.split(':')
    // Tamper with the encrypted portion
    const tampered = parts[0] + ':' + parts[1] + ':' + Buffer.from('tampered').toString('base64')
    expect(() => decrypt(tampered)).toThrow()
  })

  it('handles long strings', () => {
    const original = 'a'.repeat(10000)
    const encrypted = encrypt(original)
    const decrypted = decrypt(encrypted)
    expect(decrypted).toBe(original)
  })
})

describe('maskApiKey', () => {
  it('masks a standard API key', () => {
    // 16 chars → first 4 + 8 stars + last 4 = ABCD********MNOP
    expect(maskApiKey('ABCDEFGHIJKLMNOP')).toBe('ABCD********MNOP')
  })

  it('returns **** for short keys (8 chars or less)', () => {
    expect(maskApiKey('short')).toBe('****')
    expect(maskApiKey('12345678')).toBe('****')
  })

  it('shows first 4 and last 4 for longer keys', () => {
    // 9 chars → first 4 + 1 star + last 4 = 1234*6789
    expect(maskApiKey('123456789')).toBe('1234*6789')
  })

  it('handles exactly 9 chars', () => {
    expect(maskApiKey('ABCDEFGHI')).toBe('ABCD*FGHI')
  })
})
