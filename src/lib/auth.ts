export const AUTH_COOKIE_NAME = 'brrr_session'
export const AUTH_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60

export async function createSessionToken(apiKey: string): Promise<string> {
  const bytes = new TextEncoder().encode(`brrr-session:${apiKey}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}
