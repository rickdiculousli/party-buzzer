import { useEffect, useRef, useState } from 'preact/hooks'
import { useOpen, useSocket } from './useSocket.ts'

/** A short square-wave blip. Cheaper and more reliable than shipping an audio file. */
function blip(ctx: AudioContext, hz = 660) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = hz
  gain.gain.setValueAtTime(0.25, ctx.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
  osc.connect(gain).connect(ctx.destination)
  osc.start()
  osc.stop(ctx.currentTime + 0.15)
}

export function Player() {
  const { state, playerId, connected, now, send } = useSocket('player')
  const [name, setName] = useState(() => localStorage.getItem('playerName') ?? '')
  const [ready, setReady] = useState(() => !!localStorage.getItem('playerId'))
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
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void wakeLock.current?.release()
    }
  }, [ready])

  const round = state?.round
  const mine = round?.order.find((b) => b.playerId === playerId)
  const key =
    state?.mode === 'teams'
      ? state.players.find((p) => p.id === playerId)?.teamId ?? playerId
      : playerId
  const barred = !!key && !!round?.lockedOut.includes(key)
  const score = key ? state?.scores[key] ?? 0 : 0

  // The go cue. Lower than the buzz blip so the two never get confused, and
  // skipped for players who are locked out and cannot act on it.
  const open = useOpen(round, now, () => {
    if (barred) return
    navigator.vibrate?.([40, 40, 40])
    if (audio.current) blip(audio.current, 440)
  })

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
        <h1>Party Buzzer</h1>
        <input
          class="name"
          placeholder="Your name"
          value={name}
          maxLength={20}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <button class="big" onClick={join} disabled={!name.trim()}>
          Tap to join
        </button>
        <p class="hint">Tapping also turns on the buzzer sound.</p>
      </main>
    )
  }

  const buzz = () => {
    if (!open || barred || mine) return
    // Stamp before anything else so render work never inflates the time.
    send({ t: 'buzz', at: now() })
    navigator.vibrate?.(60)
    if (audio.current) blip(audio.current)
  }

  // deltaMs is computed before redaction, so 0 means first across the whole field.
  const won = !!mine && mine.deltaMs === 0
  let label = 'WAIT'
  let mood = 'idle'
  if (barred) { label = 'LOCKED OUT'; mood = 'barred' }
  else if (mine && round?.phase === 'LOCKED') {
    label = won ? "YOU'RE UP" : `+${mine.deltaMs}ms`
    mood = won ? 'first' : 'placed'
  } else if (mine) { label = 'BUZZED'; mood = 'placed' }
  else if (open) { label = 'BUZZ'; mood = 'open' }

  return (
    <main class="player">
      <header>
        <span>{state?.players.find((p) => p.id === playerId)?.name}</span>
        <span class={connected ? 'dot on' : 'dot off'} />
        <span class="score">{score}</span>
      </header>
      <button
        class={`buzzer ${mood}`}
        onPointerDown={buzz}
        disabled={!open || barred || !!mine}
      >
        {label}
      </button>
    </main>
  )
}
