import { useEffect, useRef, useState } from 'preact/hooks'
import { play, tune } from './sound.ts'
import { isPenalty } from '../shared/protocol.ts'
import type { State } from '../shared/protocol.ts'

export type Reveal = {
  settled: boolean
  retired: boolean
  onSettled: () => void
}

export function useReveal(round?: State['round'], active = true): Reveal {
  const spoken = round?.spoken
  const spokenKey = spoken ? `${spoken.name}:${spoken.hit}:${spoken.transcript}` : ''
  const [settledKey, setSettledKey] = useState('')
  const settled = !spokenKey || settledKey === spokenKey

  const award = round?.award
  const awardKey = award ? `${award.name}:${award.points}:${isPenalty(award) ? 'p' : 'a'}` : ''
  const thudded = useRef('')
  useEffect(() => {
    if (!active) return
    if (!settled) return
    if (!awardKey) {
      thudded.current = ''
      return
    }
    if (awardKey === thudded.current) return
    thudded.current = awardKey
    play(isPenalty(award) ? 'penalty' : 'award')
  }, [awardKey, settled, active])

  const [retiredKey, setRetiredKey] = useState('')
  useEffect(() => {
    if (!active) return
    if (!settled) return
    if (!isPenalty(award)) {
      setRetiredKey('')
      return
    }
    const dwell = tune('--penalty-dwell')
    const t = setTimeout(() => setRetiredKey(awardKey), dwell)
    return () => clearTimeout(t)
  }, [awardKey, settled, active])

  return {
    settled,
    retired: !!awardKey && retiredKey === awardKey,
    onSettled: () => setSettledKey(spokenKey),
  }
}
