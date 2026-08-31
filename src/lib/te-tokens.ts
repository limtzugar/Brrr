// ─── TE Design Tokens — Static color definitions ───────────────────────────
// Single source of truth for the Trading Platform TE design system.
// Theme context/hooks are in te-theme.tsx for 'use client' boundary.

// ─── Dark Theme (default) ──────────────────────────────────────────────────
export const TE_DARK = {
  // Primary
  orange: '#FF6600',
  orangeDark: '#CC5200',
  orangeLight: '#FF8533',

  // Backgrounds
  bg: '#0a0a0a',
  bgCard: '#111111',
  bgCardHover: '#1a1a1a',
  bgInput: '#1a1a1a',

  // Borders
  border: '#222222',
  borderLight: '#333333',

  // Text
  text: '#e0e0e0',
  textMuted: '#888888',
  textDim: '#555555',

  // Semantic colors
  green: '#10b981',
  greenBg: 'rgba(16,185,129,0.1)',
  red: '#ef4444',
  redBg: 'rgba(239,68,68,0.1)',
  blue: '#3b82f6',
  blueBg: 'rgba(59,130,246,0.1)',
  purple: '#8b5cf6',
  purpleBg: 'rgba(139,92,246,0.1)',
  yellow: '#eab308',
  yellowBg: 'rgba(234,179,8,0.1)',
  cyan: '#06b6d4',
  cyanBg: 'rgba(6,182,212,0.1)',
  pink: '#ec4899',
  pinkBg: 'rgba(236,72,153,0.1)',
  teal: '#14b8a6',
  tealBg: 'rgba(20,184,166,0.1)',

  // Typography
  mono: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
} as const

// ─── Light Theme ───────────────────────────────────────────────────────────
export const TE_LIGHT = {
  // Primary
  orange: '#E85D00',
  orangeDark: '#B84D00',
  orangeLight: '#FF7A1F',

  // Backgrounds
  bg: '#f5f5f0',
  bgCard: '#ffffff',
  bgCardHover: '#f0f0eb',
  bgInput: '#eeeee8',

  // Borders
  border: '#d5d5d0',
  borderLight: '#c0c0b8',

  // Text
  text: '#1a1a1a',
  textMuted: '#666660',
  textDim: '#999990',

  // Semantic colors
  green: '#0d9668',
  greenBg: 'rgba(13,150,104,0.08)',
  red: '#dc2626',
  redBg: 'rgba(220,38,38,0.08)',
  blue: '#2563eb',
  blueBg: 'rgba(37,99,235,0.08)',
  purple: '#7c3aed',
  purpleBg: 'rgba(124,58,237,0.08)',
  yellow: '#ca8a04',
  yellowBg: 'rgba(202,138,4,0.08)',
  cyan: '#0891b2',
  cyanBg: 'rgba(8,145,178,0.08)',
  pink: '#db2777',
  pinkBg: 'rgba(219,39,119,0.08)',
  teal: '#0d9488',
  tealBg: 'rgba(13,148,136,0.08)',

  // Typography
  mono: "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
} as const

// ─── Backward-compatible default export (dark) ────────────────────────────
export const TE = TE_DARK

// ─── Deterministic PRNG (mulberry32) ───────────────────────────────────────
export function seededRandom(seed: number): () => number {
  let state = seed | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ─── Deterministic sparkline data ──────────────────────────────────────────
export function seededSparkline(seed: number, length = 8): number[] {
  const rng = seededRandom(seed)
  const data: number[] = []
  let value = 50
  for (let i = 0; i < length; i++) {
    value += (rng() - 0.48) * 12
    value = Math.max(5, Math.min(95, value))
    data.push(value)
  }
  return data
}

// ─── Placeholder data visual indicators ────────────────────────────────────

export const PLACEHOLDER_BADGE_STYLE: Record<string, string | number> = {
  background: 'rgba(217,119,6,0.12)',
  color: '#d97706',
  border: '1px solid rgba(217,119,6,0.25)',
  fontFamily: TE.mono,
  fontSize: '9px',
  fontWeight: 700,
  padding: '1px 5px',
  borderRadius: '2px',
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  display: 'inline-flex',
  alignItems: 'center',
  gap: '3px',
}

export const PLACEHOLDER_WRAPPER_STYLE: Record<string, string | number> = {
  background: 'rgba(217,119,6,0.04)',
  border: '1px dashed rgba(217,119,6,0.2)',
  borderRadius: '4px',
  padding: '8px',
}
