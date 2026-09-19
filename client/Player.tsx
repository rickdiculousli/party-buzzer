import { useEffect, useRef, useState } from 'preact/hooks'
import { useOpen, useSocket, type SocketFixture } from './useSocket.ts'
import { Talk } from './Talk.tsx'
import { colorForPlayer, standings } from './ui.ts'
import { PlayerDuel } from './PlayerDuel.tsx'
import { PlayerItems } from './PlayerItems.tsx'
import { momentOf, phoneOf } from '../shared/wall.ts'
import type { Mood } from '../shared/wall.ts'
import type { State } from '../shared/protocol.ts'
import { scoreKey } from '../shared/scoring.ts'
import { MINIGAMES } from './minigames.tsx'
import { ScoreChange, useFlip } from './fx.tsx'

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
  const list = useRef<HTMLOListElement>(null)
  useFlip(list)
  const ordinal = (i: number) =>
    i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`

  return (
    <div class="dial" aria-label="Standings" data-review-id="phone:standings">
      <ol class="dial__list" ref={list}>
        {rows.map((r, i) => (
          <li key={r.key} data-key={r.key} data-review-id={`phone:standing:${r.key}`} class="dial__row fx-pop" style={{ '--id': r.color }}>
            <span class={i < 3 ? `dial__rank rank rank--${i + 1}` : 'dial__rank rank'}>
              {ordinal(i)}
            </span>
            <span class="dial__name">{r.label}</span>
            <ScoreChange class="dial__score readout" score={r.score} />
          </li>
        ))}
      </ol>
      <div class="dial__glass" aria-hidden="true" />
    </div>
  )
}

export type PlayerPreview = {
  socket: SocketFixture
  open: boolean
  delay: number
  pressed: boolean
}

export function Player({ preview }: { preview?: PlayerPreview } = {}) {
  const { state, playerId, connected, now, send, minigameFrame, minigameAck, minigameTouches } = useSocket('player', preview?.socket)
  const [name, setName] = useState(() => localStorage.getItem('playerName') ?? '')
  // Always start behind the tap, even for a phone we recognise. Audio only
  // unlocks inside a user gesture, so skipping the tap means silence all game.
  const [ready, setReady] = useState(!!preview)
  const returning = !!localStorage.getItem('playerId')
  const audio = useRef<AudioContext | null>(null)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const micOk = useRef(false)

  // Hold the screen awake while playing; re-acquire after the tab is hidden.
  useEffect(() => {
    if (preview) return
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
  }, [ready, preview])

  const round = state?.round
  const mine = round?.order.find((b) => b.playerId === playerId)
  // This phone has pressed for this arm. Local, because the room learns nothing
  // for a full second and a buzzer that looks unchanged after a press feels
  // broken. Keyed on the arm so it clears itself for the next question.
  const [pressedFor, setPressedFor] = useState(
    preview?.pressed ? (state?.round.attemptId ?? '') : '',
  )
  const key = state && playerId ? scoreKey(state, playerId) : playerId
  const barred = !!key && !!round?.lockedOut.includes(key)
  const frozen =
    !!state &&
    !!playerId &&
    state.effects.some(
      (e) =>
        e.kind === 'frozen' &&
        e.playerId === playerId &&
        e.attemptId === state.round.attemptId,
    )
  const buzzable = !!playerId && !!round?.buzzable?.includes(playerId)
  const spectator = !!round?.buzzable && !buzzable && !!playerId
  const nameOf = (id: string) => state?.players.find((p) => p.id === id)?.name ?? '?'
  const buzzableNames = round?.buzzable?.map(nameOf)

  const score = key ? state?.scores[key] ?? 0 : 0
  const armed = round?.phase === 'ARMED' || round?.phase === 'COLLECTING'
  const pressed = !!round && pressedFor === round.attemptId && !!round.attemptId

  // The go cue. Lower than the buzz blip so the two never get confused, and
  // skipped for players who are locked out and cannot act on it.
  const opening = useOpen(round, now, () => {
    if (preview) return
    if (barred || frozen || spectator) return
    navigator.vibrate?.([40, 40, 40])
    blip(audio.current, 440)
  }, !preview)
  const open = preview?.open ?? opening.open
  const delay = preview?.delay ?? opening.delay

  // A distinct low double-thud when you are shut out, so the phone tells you
  // why nothing happened instead of leaving you mashing a dead button.
  useEffect(() => {
    if (preview) return
    if (!ready || !barred) return
    navigator.vibrate?.([120, 60, 120])
    blip(audio.current, 180, 260)
  }, [barred, ready, preview])

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

  if (state?.minigame) {
    const Surface = MINIGAMES[state.minigame.id].player
    return <Surface state={state} playerId={playerId} frame={minigameFrame} now={now} send={send} ack={minigameAck} touches={minigameTouches} />
  }

  const buzz = () => {
    if (preview) return
    if (!open || barred || pressed || frozen || spectator) return
    // Stamp before anything else so render work never inflates the time.
    send({ t: 'buzz', at: now() })
    setPressedFor(round?.attemptId ?? '')
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
  const { label, sub, mood, talk } = phoneOf(moment, {
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
    judging: !!round?.judge,
  })

  const me = state?.players.find((p) => p.id === playerId)

  return (
    <main class="player" data-review-id="phone:root">
      <div class="player__bar" data-review-id="phone:identity">
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
        <ScoreChange class="player__score readout" score={score} />
      </div>

      {round?.image && <img class="player__image" data-review-id="phone:image" src={round.image} alt="" />}
      {!!round?.fragments?.length && (
        <p class="player__question" data-review-id="phone:question">{round.fragments.join(' ')}</p>
      )}

      {/* Reserved whether or not the filament is in it. Otherwise arming
          shrinks the buzzer under the thumb that is about to press it. */}
      <div class="player__countdown">
        {armed && !barred && (
          <div
            key={round?.attemptId}
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
          data-review-id="phone:buzzer"
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
