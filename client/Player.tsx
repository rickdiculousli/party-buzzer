import { useEffect, useRef, useState } from 'preact/hooks'
import { useOpen, useSocket } from './useSocket.ts'
import { colorForPlayer, standings } from './ui.ts'
import type { State } from '../shared/protocol.ts'

// Mirror of server/items.ts — ids, display names, targeting. The wire carries
// only ids, and three items do not justify a catalog channel.
const ITEM_INFO: Record<string, { name: string; opponent: boolean; passive?: boolean }> = {
  freeze: { name: 'Freeze', opponent: true },
  shield: { name: 'Shield', opponent: false, passive: true },
  steal: { name: 'Steal', opponent: false },
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
    state?.mode === 'teams'
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
  const myItems = state && playerId ? (state.items[playerId] ?? []) : []
  const itemCounts = [...myItems.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<string, number>())]
  const opponents = state?.players.filter((p) => p.id !== playerId && p.connected) ?? []
  const duel = state?.duel
  const duelRule = state?.duelRules.find((r) => r.id === duel?.rule)
  const myDuelEntry = duel?.pool.find((e) => e.playerId === playerId)
  const myVoteFor = duel?.pool.find((e) => e.votes.includes(playerId ?? ''))?.playerId
  const inCount = duel?.pool.filter((e) => e.in).length ?? 0
  const finalist = !!playerId && !!round?.candidates?.includes(playerId)
  const spectator = !!round?.candidates && !finalist && !!playerId
  // Both finalists missed: candidates is `[]`, still truthy, so the two checks
  // above alone would call every player (finalists included) a spectator of a
  // duel with nobody named in it. Dead is its own state.
  const dead = round?.candidates?.length === 0
  const finalistNames = round?.candidates?.map(
    (id) => state?.players.find((p) => p.id === id)?.name ?? '?',
  )
  const [targetFor, setTargetFor] = useState<string | null>(null)
  const score = key ? state?.scores[key] ?? 0 : 0
  const armed = round?.phase === 'ARMED' || round?.phase === 'COLLECTING'
  const pressed = !!round && pressedFor === round.armedAt && round.armedAt > 0

  // The go cue. Lower than the buzz blip so the two never get confused, and
  // skipped for players who are locked out and cannot act on it.
  const { open, lead } = useOpen(round, now, () => {
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

  // The join tap doubles as the gesture that unlocks audio on iOS.
  const join = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    localStorage.setItem('playerName', trimmed)
    audio.current = new AudioContext()
    void audio.current.resume()
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

  const fireItem = (itemId: string, targetId?: string) => {
    send({ t: 'act', act: 'useItem', data: { itemId, targetId } })
    setTargetFor(null)
  }

  // deltaMs is computed before redaction, so 0 means first across the whole field.
  const won = !!mine && mine.deltaMs === 0
  // The award keeps the result on screen after the host scores it, the same way
  // the board does.
  const settled = round?.phase === 'LOCKED' || !!round?.award

  let label = 'Wait'
  let sub = 'The host has not armed yet'
  let mood = ''
  if (frozen) {
    label = 'Frozen'
    sub = 'A freeze item shut you out of this question'
    mood = 'is-barred'
  } else if (barred) {
    label = 'Out'
    sub = 'Wrong answer — you sit out the rest of this question'
    mood = 'is-barred'
  } else if (dead) {
    label = 'Duel'
    sub = 'Both missed — waiting for the host'
    mood = 'is-barred'
  } else if (spectator) {
    label = 'Duel'
    sub = `${finalistNames?.join(' vs ')} — you sit this one out`
    mood = 'is-barred'
  } else if (mine && settled) {
    label = won ? 'You’re up' : `+${mine.deltaMs} ms`
    sub = won ? 'Answer it' : 'Someone beat you to it'
    mood = won ? 'is-first' : 'is-placed'
  } else if (pressed) {
    label = 'In'
    // The round closed without this buzz in the order: it landed after the
    // window shut. Say so instead of counting a field that no longer exists.
    sub = settled
      ? 'Too late — the round closed first'
      : 'Counting the rest of the field'
    mood = 'is-placed'
  } else if (open) {
    label = 'Buzz'
    sub = ''
    mood = 'is-open'
  } else if (armed) {
    label = 'Wait'
    sub = 'Any moment'
  }

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
      <div class="player__lead-in">
        {armed && !barred && (
          <div
            key={round?.armedAt}
            class={open ? 'filament is-hot player__filament' : 'filament player__filament'}
            style={{ '--lead': `${lead}ms` }}
          />
        )}
      </div>

      {duel && !duel.seated && duelRule && duelRule.entry !== 'none' && (
        <div class="player__duel">
          <p class="eyebrow">Heads-up — who plays?</p>
          {(duelRule.entry === 'volunteer' || duelRule.entry === 'both') && (
            <>
              <button
                class={myDuelEntry?.in ? 'btn btn--primary' : 'btn'}
                onPointerDown={() =>
                  send({ t: 'act', act: myDuelEntry?.in ? 'duelBackOff' : 'duelVolunteer' })
                }
              >
                {myDuelEntry?.in ? 'Back off' : 'I’m in'}
              </button>
              <p class="muted">
                {inCount} in{inCount > 2 ? ' — someone has to back off' : ''}
              </p>
            </>
          )}
          {(duelRule.entry === 'vote' || duelRule.entry === 'both') && (
            <div class="player__items">
              {opponents.map((p) => {
                const votes = duel.pool.find((e) => e.playerId === p.id)?.votes.length ?? 0
                return (
                  <button
                    key={p.id}
                    class={myVoteFor === p.id ? 'btn btn--primary' : 'btn'}
                    onPointerDown={() => send({ t: 'act', act: 'duelVote', data: p.id })}
                  >
                    {p.name}
                    {votes > 0 ? ` · ${votes}` : ''}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      <button
        class={`buzzer ${mood}`}
        onPointerDown={buzz}
        disabled={!open || barred || pressed || frozen || spectator}
      >
        {label}
        {sub && <span class="buzzer__sub">{sub}</span>}
      </button>

      {itemCounts.length > 0 && (
        <div class="player__items">
          {targetFor ? (
            <>
              <span class="muted">Pick a target</span>
              {opponents.map((p) => (
                <button key={p.id} class="btn" onPointerDown={() => fireItem(targetFor, p.id)}>
                  {p.name}
                </button>
              ))}
              <button class="btn btn--ghost" onPointerDown={() => setTargetFor(null)}>
                Cancel
              </button>
            </>
          ) : (
            itemCounts.map(([id, n]) => {
              const info = ITEM_INFO[id]
              if (!info) return null
              const count = n > 1 ? ` ×${n}` : ''
              // Passive items (shield) show as chips: held, never fired by hand.
              if (info.passive) return <span key={id} class="chip chip--data">{info.name}{count}</span>
              return (
                <button
                  key={id}
                  class="btn"
                  onPointerDown={() => (info.opponent ? setTargetFor(id) : fireItem(id))}
                >
                  {info.name}{count}
                </button>
              )
            })
          )}
        </div>
      )}

      {state && <StandingsDial state={state} />}
    </main>
  )
}
