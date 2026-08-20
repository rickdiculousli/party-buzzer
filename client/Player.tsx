import { useEffect, useRef, useState } from 'preact/hooks'
import { useOpen, useSocket } from './useSocket.ts'
import { Talk } from './Talk.tsx'
import { colorForPlayer, standings } from './ui.ts'
import { PlayerDuel } from './PlayerDuel.tsx'
import { PlayerItems } from './PlayerItems.tsx'
import { momentOf, phoneOf } from '../shared/wall.ts'
import type { Mood } from '../shared/wall.ts'
import type { State } from '../shared/protocol.ts'

/** `phoneOf` names the mood; the stylesheet is where it becomes a colour. */
const MOOD_CLASS: Record<Mood, string> = {
  waiting: 'is-waiting',
  open: 'is-open',
  placed: 'is-placed',
  first: 'is-first',
  barred: 'is-barred',
}

/**
 * A short square-wave blip. Cheaper and more reliable than shipping an audio
 * file. Resumes first: iOS suspends the context whenever the phone locks.
 */
function blip(ctx: AudioContext | null, hz = 660, ms = 150) {
  if (!ctx) return
  if (ctx.state === 'suspended') void ctx.resume()
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = hz
  gain.gain.setValueAtTime(0.25, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000)
  osc.connect(gain).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + ms / 1000)
}


/**
 * The standings as a picker dial: three rows through a clear window, the rest
 * of the field a scroll away under frosted edges. Rows tilt around a shared
 * cylinder axis by their distance from the middle, like the old time pickers.
 */
function StandingsDial({ state }: { state: State }) {
  const rows = standings(state)
  const ordinal = (i: number) =>
    i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`

  return (
    <div class="dial" aria-label="Standings">
      <ol class="dial__list">
        {rows.map((r, i) => (
          <li key={r.key} class="dial__row" style={{ '--id': r.color }}>
            <span class={i < 3 ? `dial__rank rank rank--${i + 1}` : 'dial__rank rank'}>
              {ordinal(i)}
            </span>
            <span class="dial__name">{r.label}</span>
            <span class="dial__score readout">{r.score}</span>
          </li>
        ))}
      </ol>
      <div class="dial__glass" aria-hidden="true" />
    </div>
  )
}

export function Player() {
  const { state, playerId, connected, now, send } = useSocket('player')
  const [name, setName] = useState(() => localStorage.getItem('playerName') ?? '')
  // Always start behind the tap, even for a phone we recognise. Audio only
  // unlocks inside a user gesture, so skipping the tap means silence all game.
  const [ready, setReady] = useState(false)
  const returning = !!localStorage.getItem('playerId')
  const audio = useRef<AudioContext | null>(null)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const micOk = useRef(false)

  // Hold the screen awake while playing; re-acquire after the tab is hidden.
  useEffect(() => {
    if (!ready) return
    const acquire = async () => {
      try {
        wakeLock.current = await navigator.wakeLock?.request('screen')
      } catch {
        // Unsupported or denied. The game still works, the screen just dims.
      }
    }
    void acquire()
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void acquire()
      // A screen lock suspends the audio context. Coming back is a resume
      // opportunity, so take it rather than waiting for the next gesture.
      void audio.current?.resume()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void wakeLock.current?.release()
    }
  }, [ready])

  const round = state?.round
  const mine = round?.order.find((b) => b.playerId === playerId)
  // This phone has pressed for this arm. Local, because the room learns nothing
  // for a full second and a buzzer that looks unchanged after a press feels
  // broken. Keyed on the arm so it clears itself for the next question.
  const [pressedFor, setPressedFor] = useState(0)
  const key =
    state?.grouping === 'teams'
      ? state.players.find((p) => p.id === playerId)?.teamId ?? playerId
      : playerId
  const barred = !!key && !!round?.lockedOut.includes(key)
  const frozen =
    !!state &&
    !!playerId &&
    state.effects.some(
      (e) =>
        e.kind === 'frozen' &&
        e.playerId === playerId &&
        e.roundArmedAt === state.round.armedAt,
    )
  const buzzable = !!playerId && !!round?.buzzable?.includes(playerId)
  const spectator = !!round?.buzzable && !buzzable && !!playerId
  const nameOf = (id: string) => state?.players.find((p) => p.id === id)?.name ?? '?'
  const buzzableNames = round?.buzzable?.map(nameOf)

  const score = key ? state?.scores[key] ?? 0 : 0
  const armed = round?.phase === 'ARMED' || round?.phase === 'COLLECTING'
  const pressed = !!round && pressedFor === round.armedAt && round.armedAt > 0

  // The go cue. Lower than the buzz blip so the two never get confused, and
  // skipped for players who are locked out and cannot act on it.
  const { open, delay } = useOpen(round, now, () => {
    if (barred || frozen || spectator) return
    navigator.vibrate?.([40, 40, 40])
    blip(audio.current, 440)
  })

  // A distinct low double-thud when you are shut out, so the phone tells you
  // why nothing happened instead of leaving you mashing a dead button.
  useEffect(() => {
    if (!ready || !barred) return
    navigator.vibrate?.([120, 60, 120])
    blip(audio.current, 180, 260)
  }, [barred, ready])

  // This phone is the locked-in leader and the judge is listening. It is what
  // mounts `<Talk>`, and the mic's whole life is that mount — so this one line
  // is also where the window opens and closes.
  const talk = !!mine && mine.deltaMs === 0 && round?.phase === 'LOCKED' && !!round?.judge

  // The join tap doubles as the gesture that unlocks audio on iOS.
  const join = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    localStorage.setItem('playerName', trimmed)
    audio.current = new AudioContext()
    void audio.current.resume()
    // Mic permission, asked once up front inside the same mandatory tap. The
    // stream itself opens on lock-in — this is only the dialog, so that the
    // first answer of the night is not spent staring at it.
    void navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((s) => {
        micOk.current = true
        for (const t of s.getTracks()) t.stop()
      })
      .catch(() => {})
    send({ t: 'hello', role: 'player', name: trimmed })
    setReady(true)
  }

  if (!ready) {
    return (
      <main class="join">
        <h1 class="join__mark">Party<br />Buzzer</h1>
        <input
          class="input"
          placeholder="Your name"
          value={name}
          maxLength={20}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <button class="btn btn--primary join__go" onClick={join} disabled={!name.trim()}>
          {returning && name.trim() ? `Play as ${name.trim()}` : 'Join the game'}
        </button>
        <p class="join__hint">
          {returning
            ? 'Your score is waiting. Tapping turns the buzzer sound back on.'
            : 'Tapping also turns on the buzzer sound.'}
        </p>
      </main>
    )
  }

  const buzz = () => {
    if (!open || barred || pressed || frozen || spectator) return
    // Stamp before anything else so render work never inflates the time.
    send({ t: 'buzz', at: now() })
    setPressedFor(round?.armedAt ?? 0)
    navigator.vibrate?.(60)
    blip(audio.current)
  }


  // deltaMs is computed before redaction, so 0 means first across the whole field.
  const won = !!mine && mine.deltaMs === 0

  // `settled` and `retired` are both already true here: the phone renders no
  // transcript and no award stamp, so it has no reveal to wait on — neither
  // dwell exists on this surface for the moment to sit through.
  const moment = state
    ? momentOf(state, { open, settled: true, retired: true })
    : ('idle:welcome' as const)
  const { label, sub, mood } = phoneOf(moment, {
    frozen,
    barred,
    spectator,
    // Not taken from the moment: `verdict:hold` outranks `duel:dead` on the
    // wall, and telling a phone "reopening in a moment" when both seated players
    // have missed is a promise nothing will keep.
    dead: state?.round.buzzable?.length === 0,
    buzzableNames,
    won,
    deltaMs: mine?.deltaMs,
    pressed,
    armed,
    open,
  })

  const me = state?.players.find((p) => p.id === playerId)

  return (
    <main class="player">
      <div class="player__bar">
        <span
          class="player__name"
          style={{ '--id': state && playerId ? colorForPlayer(state, playerId) : undefined }}
        >
          {me?.name}
        </span>
        <span class="lamp">
          <span class={connected ? 'lamp-dot is-on' : 'lamp-dot is-off'} />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
        <span class="player__score readout">{score}</span>
      </div>

      {!!round?.fragments?.length && (
        <p class="player__question">{round.fragments.join(' ')}</p>
      )}

      {/* Reserved whether or not the filament is in it. Otherwise arming
          shrinks the buzzer under the thumb that is about to press it. */}
      <div class="player__countdown">
        {armed && !barred && (
          <div
            key={round?.armedAt}
            class={open ? 'filament is-hot player__filament' : 'filament player__filament'}
            style={{ '--delay': `${delay}ms` }}
          />
        )}
      </div>

      {state && <PlayerDuel state={state} playerId={playerId} send={send} />}

      {talk ? (
        <Talk
          playerId={playerId}
          until={round?.judge?.until}
          capSec={state?.answerWindowSec ?? 0}
          now={now}
          ctx={audio.current}
          micOk={micOk.current}
        />
      ) : (
        <button
          class={`buzzer ${MOOD_CLASS[mood]}`}
          onPointerDown={buzz}
          disabled={!open || barred || pressed || frozen || spectator}
        >
          {label}
          {sub && <span class="buzzer__sub">{sub}</span>}
        </button>
      )}

      {state && <PlayerItems state={state} playerId={playerId} send={send} />}

      {state && <StandingsDial state={state} />}
    </main>
  )
}
