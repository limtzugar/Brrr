'use client'

import { useState, useEffect, useRef } from 'react'

/** Smoothly interpolates an array of numbers toward target values at 60fps.
 *  Handles length changes gracefully: extends or trims the array, then lerps.
 *  Detects sliding window shifts and realigns the current array to prevent
 *  left-edge "breaking" artifacts when old data scrolls off the window.
 *
 *  FIX: targetRef updated synchronously during render (not in useEffect) to
 *  prevent React 18 concurrent mode from deferring the update, which caused
 *  the RAF loop to see stale targets and permanently converge (chart freeze). */
export function useSmoothArray(
  target: number[],
  speed: number = 0.35
): number[] {
  const [current, setCurrent] = useState<number[]>(() => [...target])
  const targetRef = useRef(target)
  const rafRef = useRef<number | undefined>(undefined)
  const shiftPendingRef = useRef(0)
  const prevTargetRef = useRef(target)

  // Detect sliding window shift when target reference changes
  // When the window scrolls left by 1: new[i] = old[i+1]
  // We detect this and realign the smoothed array to avoid left-edge distortion
  if (target !== prevTargetRef.current) {
    const prev = prevTargetRef.current
    if (prev.length === target.length && target.length > 5) {
      let matchCount = 0
      const checkN = Math.min(target.length - 1, 20)
      for (let i = 0; i < checkN; i++) {
        // new[i] should equal old[i+1] if window shifted left by 1
        if (Math.abs(target[i] - prev[i + 1]) < 0.0001) matchCount++
      }
      // Require 85%+ match to confirm it's a real shift (not just value update)
      if (matchCount >= Math.ceil(checkN * 0.85)) {
        shiftPendingRef.current += 1
      }
    }
    prevTargetRef.current = target
  }

  // CRITICAL FIX: Update targetRef synchronously during render, NOT in useEffect.
  targetRef.current = target

  useEffect(() => {
    let running = true
    const animate = () => {
      if (!running) return
      setCurrent(prev => {
        const t = targetRef.current
        // Handle length change: extend or trim preserving interpolated values
        let base: number[]
        if (prev.length < t.length) {
          base = [...prev, ...t.slice(prev.length)]
        } else if (prev.length > t.length) {
          base = prev.slice(0, t.length)
        } else {
          base = prev
        }

        // Apply pending shift(s) — realign smoothed array with shifted target.
        // When window scrolls left by N, current[N..] already matches new target[0..],
        // so we shift current left by N and append the N newest target values.
        // This eliminates left-edge "breaking" artifacts.
        if (shiftPendingRef.current > 0) {
          const shift = Math.min(shiftPendingRef.current, base.length - 1)
          shiftPendingRef.current = 0
          base = [...prev.slice(shift), ...t.slice(t.length - shift)]
        }

        // Lerp each point toward target
        let maxDiff = 0
        const next = base.map((v, i) => {
          const diff = t[i] - v
          const ad = Math.abs(diff)
          if (ad > maxDiff) maxDiff = ad
          return ad < 0.0001 ? t[i] : v + diff * speed
        })
        // Skip re-render if nothing changed
        return maxDiff > 0.0001 ? next : t  // return target (not prev) when converged
      })
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => {
      running = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [speed])

  // ── Safety: always return array matching target length ──
  if (current.length < target.length) {
    return [...current, ...target.slice(current.length)]
  }
  if (current.length > target.length) {
    return current.slice(0, target.length)
  }
  return current
}

/** Smoothly interpolates a single value toward target at 60fps. */
export function useSmoothValue(
  target: number,
  speed: number = 0.15
): number {
  const [current, setCurrent] = useState(target)
  const targetRef = useRef(target)
  const rafRef = useRef<number | undefined>(undefined)

  // CRITICAL FIX: Same as useSmoothArray — sync ref update
  targetRef.current = target

  useEffect(() => {
    let running = true
    const animate = () => {
      if (!running) return
      setCurrent(prev => {
        const diff = targetRef.current - prev
        if (Math.abs(diff) < 0.0001) return targetRef.current
        return prev + diff * speed
      })
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => {
      running = false
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [speed])

  return current
}
