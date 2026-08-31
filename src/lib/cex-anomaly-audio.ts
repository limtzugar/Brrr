// ─── CEX Anomaly — Audio Feedback ──────────────────────────────────────────
// Web Audio API sounds for position open / profit close / loss close
// No external files needed — pure oscillator synthesis

let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    return audioCtx
  } catch {
    return null
  }
}

/** Two-tone beep: high-low alert pattern when bot opens a position */
export function playPositionOpenSound() {
  const ctx = getAudioCtx()
  if (!ctx) return

  try {
    const now = ctx.currentTime

    // First tone (higher pitch — urgency)
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.frequency.value = 880 // A5
    osc1.type = 'sine'
    gain1.gain.setValueAtTime(0.3, now)
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15)
    osc1.start(now)
    osc1.stop(now + 0.15)

    // Second tone (lower pitch — confirmation)
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.frequency.value = 660 // E5
    osc2.type = 'sine'
    gain2.gain.setValueAtTime(0.3, now + 0.18)
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.35)
    osc2.start(now + 0.18)
    osc2.stop(now + 0.35)
  } catch {
    // Audio not available — silent fallback
  }
}

/** Rising major arpeggio C5→E5→G5 — "ka-ching" on profitable close */
export function playProfitCloseSound() {
  const ctx = getAudioCtx()
  if (!ctx) return

  try {
    const now = ctx.currentTime
    const notes = [
      { freq: 523.25, start: 0,    dur: 0.12 },  // C5
      { freq: 659.25, start: 0.10, dur: 0.12 },  // E5
      { freq: 783.99, start: 0.20, dur: 0.18 },  // G5 — held longer
    ]
    for (const note of notes) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = note.freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0, now + note.start)
      gain.gain.linearRampToValueAtTime(0.25, now + note.start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.01, now + note.start + note.dur)
      osc.start(now + note.start)
      osc.stop(now + note.start + note.dur)
    }
  } catch {
    // Audio not available — silent fallback
  }
}

/** Descending sawtooth buzz A4→F4 — liquidation / loss close alert.
 *  Ominous minor-third descent with sawtooth grit. Used for:
 *  - Position closed at loss (netPnl < 0)
 *  - Position liquidated (hit shield SL) */
export function playLossCloseSound() {
  const ctx = getAudioCtx()
  if (!ctx) return

  try {
    const now = ctx.currentTime

    // First stab — A4, short and sharp
    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.frequency.value = 440 // A4
    osc1.type = 'sawtooth'
    gain1.gain.setValueAtTime(0.18, now)
    gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.18)
    osc1.start(now)
    osc1.stop(now + 0.18)

    // Second tone — F4, minor third down, longer decay
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.frequency.value = 349 // F4
    osc2.type = 'sawtooth'
    gain2.gain.setValueAtTime(0.20, now + 0.20)
    gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.55)
    osc2.start(now + 0.20)
    osc2.stop(now + 0.55)
  } catch {
    // Audio not available — silent fallback
  }
}
