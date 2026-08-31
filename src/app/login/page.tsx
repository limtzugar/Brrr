'use client'

import { FormEvent, useState } from 'react'

export default function LoginPage() {
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Logowanie nie powiodło się.')
      window.location.assign('/')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Logowanie nie powiodło się.')
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-[#05070a] px-4 text-white">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-lg border border-white/10 bg-white/[0.03] p-7 shadow-2xl"
      >
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.28em] text-emerald-400">
            BRRR
          </p>
          <h1 className="mt-2 text-2xl font-semibold">Dostęp do panelu</h1>
          <p className="mt-2 text-sm text-white/55">
            Wprowadź klucz skonfigurowany jako BRRR_API_KEY.
          </p>
        </div>

        <label className="block text-sm text-white/70">
          Klucz dostępu
          <input
            autoFocus
            autoComplete="current-password"
            type="password"
            value={apiKey}
            onChange={event => setApiKey(event.target.value)}
            className="mt-2 w-full rounded border border-white/15 bg-black/40 px-3 py-2.5 font-mono outline-none focus:border-emerald-400"
          />
        </label>

        {error && (
          <p className="rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || !apiKey}
          className="w-full rounded bg-emerald-400 px-4 py-2.5 font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? 'Sprawdzanie…' : 'Zaloguj'}
        </button>
      </form>
    </main>
  )
}
