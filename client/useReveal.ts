import { useEffect, useRef, useState } from 'preact/hooks'
import { parseTune, play } from './sound.ts'
import { isPenalty } from '../shared/protocol.ts'
import type { State } from '../shared/protocol.ts'

/**
 * When the room has finished being told something.
 *
 * `State` says what happened the instant it happens. The wall says it at the
 * speed a room can read, which is not the same thing — a transcript types
 * itself out, a penalty sits for its dwell — and `wallOf` needs the second
 * timing, not the first. This owns both clocks and answers in two booleans.
 *
 * It lived in `Board` as eight bindings and two effects for exactly these two
 * answers. Out here the board asks the question rather than keeping the
 * apparatus, and the keys-as-strings trick below stays where its reasons are.
 */
export type Reveal = {
  /** The transcript has been read. Always true when there is nothing spoken. */
  settled: boolean
  /** The penalty's dwell has elapsed and the stamp may come down. */
  retired: boolean
  /** Hand to `<Spoken onSettled>`; that is what makes `settled` true. */
  onSettled: () => void
}

export function useReveal(round?: State['round']): Reveal {
  /**
   * The verdict waits on the sentence. While the judge's transcript is still
   * typing itself out the room has not finished reading it, so the award — its
   * stamp, the name it lands on, the answer beneath it and the thud — is held
   * back until `Spoken` says the line has landed and its hold has elapsed.
   * Nothing spoken (a host judging by button) is nothing to wait for.
   *
   * Derived during render rather than latched by an effect. An effect runs a
   * render too late, and the broadcast that carries the transcript carries the
   * award with it — so a latched hold gives the award one frame on the wall
   * before it engages, which is a flash of the answer at the worst possible
   * moment.
   */
  const spoken = round?.spoken
  const spokenKey = spoken ? `${spoken.name}:${spoken.hit}:${spoken.transcript}` : ''
  const [settledKey, setSettledKey] = useState('')
  const settled = !spokenKey || settledKey === spokenKey

  /**
   * The award's thud, fired the moment the points appear.
   *
   * Keyed on what the award says, not on the object: every broadcast is a fresh
   * `JSON.parse`, so an identity check re-thuds on each one while the points
   * simply sit there.
   *
   * And on what it says *only*: the arm instant must stay out of the key,
   * because a penalty outlives its own arm. A rebound restamps `armedAt` while
   * the −100 is still on the wall, so a key carrying it changes under a stamp
   * that has not — the penalty sounds a second time as the buzzers open, and
   * the plaque un-retires and restarts its dwell.
   *
   * An undo-and-rejudge to the same number still sounds, because undo takes the
   * award away first: no award means an empty key, and an empty key forgets, so
   * whatever comes back is new.
   */
  const award = round?.award
  const awardKey = award ? `${award.name}:${award.points}:${isPenalty(award) ? 'p' : 'a'}` : ''
  const thudded = useRef('')
  useEffect(() => {
    if (!settled) return
    if (!awardKey) {
      thudded.current = ''
      return
    }
    if (awardKey === thudded.current) return
    thudded.current = awardKey
    play(isPenalty(award) ? 'penalty' : 'award')
  }, [awardKey, settled])

  /**
   * A penalty is a beat, not a state. It lands, the room reads the −100 against
   * the name it cost, and then the stage goes back to the question — because a
   * rebound is the same question with the buzzers open again and the clue still
   * being read. Parking the stamp and the penalized name over that for the rest
   * of the question left a result sitting on top of a question in progress.
   *
   * A payoff needs no retirement: nothing is running behind it, and the room
   * looks at the board after the host scores rather than before.
   */
  const [retiredKey, setRetiredKey] = useState('')
  useEffect(() => {
    if (!settled) return
    // Forgotten the moment there is no penalty up, for the same reason the thud
    // is: without the arm in the key, a retired "Ada −100" would otherwise
    // retire the next identical one before the room ever saw it.
    if (!isPenalty(award)) {
      setRetiredKey('')
      return
    }
    const dwell = parseTune(
      getComputedStyle(document.documentElement).getPropertyValue('--penalty-dwell'),
      2200,
    )
    const t = setTimeout(() => setRetiredKey(awardKey), dwell)
    return () => clearTimeout(t)
  }, [awardKey, settled])

  return {
    settled,
    // The key comparison stays in here: `wallOf` wants the answer, not the
    // bookkeeping that produced it.
    retired: !!awardKey && retiredKey === awardKey,
    onSettled: () => setSettledKey(spokenKey),
  }
}
