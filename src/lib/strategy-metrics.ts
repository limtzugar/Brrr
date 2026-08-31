const MIN_VOLUME_SAMPLES = 5

export type StrategyAction = 'ENTER' | 'EXIT' | 'HOLD' | 'NO_TRADE'

export function classifyPositionTransition(
  wasInPosition: boolean,
  isInPosition: boolean,
): StrategyAction {
  if (!wasInPosition && isInPosition) return 'ENTER'
  if (wasInPosition && !isInPosition) return 'EXIT'
  return isInPosition ? 'HOLD' : 'NO_TRADE'
}

export function isVolumeSpike(
  currentVolume: number,
  previousVolumes: readonly number[],
  threshold: number,
): boolean {
  if (!Number.isFinite(currentVolume) || currentVolume <= 0) return false
  if (!Number.isFinite(threshold) || threshold <= 0) return false

  const validSamples = previousVolumes.filter(
    volume => Number.isFinite(volume) && volume > 0,
  )
  if (validSamples.length < MIN_VOLUME_SAMPLES) return false

  const averageVolume =
    validSamples.reduce((sum, volume) => sum + volume, 0) / validSamples.length

  return currentVolume > averageVolume * threshold
}
