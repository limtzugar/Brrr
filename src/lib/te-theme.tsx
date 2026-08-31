'use client'

// ─── TE Theme Context — Client-only ────────────────────────────────────────
// Must be a separate 'use client' file so server components can still import
// static tokens (TE_DARK, TE_LIGHT, TE, seededRandom, etc.) from te-tokens.ts

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { TE_DARK, TE_LIGHT } from './te-tokens'

// Define the TE token type as a plain interface (not typeof literal)
// so that both TE_DARK and TE_LIGHT are assignable to it
export interface TETokens {
  orange: string
  orangeDark: string
  orangeLight: string
  bg: string
  bgCard: string
  bgCardHover: string
  bgInput: string
  border: string
  borderLight: string
  text: string
  textMuted: string
  textDim: string
  green: string
  greenBg: string
  red: string
  redBg: string
  blue: string
  blueBg: string
  purple: string
  purpleBg: string
  yellow: string
  yellowBg: string
  cyan: string
  cyanBg: string
  pink: string
  pinkBg: string
  teal: string
  tealBg: string
  mono: string
}

type ThemeMode = 'dark' | 'light'

interface ThemeContextValue {
  theme: ThemeMode
  toggleTheme: () => void
  te: TETokens
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
  te: TE_DARK as TETokens,
})

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>('dark')

  // Read persisted theme on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('brrr-theme')
      if (saved === 'light' || saved === 'dark') {
        setTheme(saved)
      }
    } catch {}
  }, [])

  // Apply theme class to <html> and persist
  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') {
      root.classList.add('dark')
      root.classList.remove('light')
    } else {
      root.classList.add('light')
      root.classList.remove('dark')
    }
    try { localStorage.setItem('brrr-theme', theme) } catch {}
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }, [])

  const te: TETokens = theme === 'dark' ? TE_DARK : TE_LIGHT

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, te }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}

export function useTE() {
  return useContext(ThemeContext).te
}

// Re-export static tokens for convenience
export { TE_DARK, TE_LIGHT } from './te-tokens'
export { TE } from './te-tokens'
