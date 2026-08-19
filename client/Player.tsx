import { useEffect, useRef, useState } from 'preact/hooks'
import type { JSX } from 'preact'
import { useOpen, useSocket } from './useSocket.ts'
import { Recorder } from './recorder.ts'
import { encodeWav } from './wav.ts'
import { colorForPlayer, eligibleForDuel, standings } from './ui.ts'
import { Votes } from './Votes.tsx'
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

/** The judge's deadline, counted down in whole seconds on the synced clock. */
function TalkCountdown({
  until,
  capSec,
  now,
}: {
  until: number
  capSec: number
  now: () => number
}) {
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 200)
    return () => clearInterval(id)
  }, [until])
  // Same rule as the arm countdown: clamp to the most it can ever be, because
  // an unclamped one once read 1.7 trillion ms.
  const left = Math.min(capSec * 1000, Math.max(0, until - now()))
  return <span>{Math.ceil(left / 1000)}s</span>
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
  const micStream = useRef<MediaStream | null>(null)
  const recorder = useRef<Recorder | null>(null)
  const [talking, setTalking] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  /** Last send was too brief to transcribe. Cleared by the next hold. */
  const [tooShort, setTooShort] = useState(false)
  const dragY = useRef(0)
  const capTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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
  const nameOf = (id: string) => state?.players.find((p) => p.id === id)?.name ?? '?'
  const finalistNames = round?.candidates?.map(nameOf)
  const seatedNames = duel?.seated?.map(nameOf)

  /**
   * Who this phone may nominate, and whether it may nominate at all.
   *
   * `eligibleForDuel`, not every connected player: someone the seat can never
   * take — a phone that joined before the host made teams, and is still on
   * none — was being offered as a target, and a vote for them is spent on a
   * name the close will silently pass over. The same rule decides both
   * directions, so a player with no team is told why their card is empty
   * rather than voting into a duel they cannot be part of.
   *
   * Your own side only, in teams mode. The seat takes one player from each
   * team, so the nomination you are being asked for is your team's — picking
   * from the other side is choosing your opponent's champion, which is either
   * a courtesy or sabotage and never an answer to the question. The server
   * refuses a vote across the line for the same reason; this is the roster
   * agreeing with it rather than the rule itself.
   */
  const myTeam = state?.players.find((p) => p.id === playerId)?.teamId
  const nominees = state
    ? eligibleForDuel(state).filter(
        (p) => p.id !== playerId && (state.mode !== 'teams' || p.teamId === myTeam),
      )
    : []
  const canNominate = state?.mode !== 'teams' || !!myTeam
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

  // This phone is the locked-in leader and the judge is listening. Derived
  // here, above the join guard, because the capture effect below is a hook.
  const talk = !!mine && mine.deltaMs === 0 && round?.phase === 'LOCKED' && !!round?.judge

  // The mic opens on lock-in and closes with the window.
  useEffect(() => {
    const ctx = audio.current
    if (!talk || !micOk.current || !ctx) return
    let dead = false
    const rec = new Recorder()
    recorder.current = rec
    void navigator.mediaDevices.getUserMedia({ audio: true }).then(async (stream) => {
      if (dead) {
        for (const t of stream.getTracks()) t.stop()
        return
      }
      micStream.current = stream
      await rec.start(stream, ctx)
      if (dead) rec.stop()
    })
    return () => {
      dead = true
      // A stray cap timer would fire sendAnswer into the next window's recorder.
      clearTimeout(capTimer.current)
      recorder.current = null
      rec.stop()
      for (const t of micStream.current?.getTracks() ?? []) t.stop()
      micStream.current = null
      setTalking(false)
      setCancelling(false)
      setTooShort(false)
    }
  }, [talk])

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

  const MAX_ANSWER_MS = 6000

  const sendAnswer = () => {
    const rec = recorder.current
    if (!rec) return
    const { samples, rate } = rec.cut()
    // A tap is not an answer; a tenth of a second of room tone would only
    // transcribe to garbage and cost the player their neg. Say so on the button
    // rather than dropping it — a send that vanishes silently is indisting-
    // uishable from a broken mic, and the window is still open to try again.
    if (samples.length < rate * 0.25) {
      setTooShort(true)
      return
    }
    setTooShort(false)
    void fetch(`/answer?player=${playerId}`, {
      method: 'POST',
      body: encodeWav(samples, rate),
    })
  }

  const talkDown = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    // Capture the pointer: the drag-down cancel leaves the button, and the
    // move/up events still have to land here.
    e.currentTarget.setPointerCapture(e.pointerId)
    dragY.current = e.clientY
    recorder.current?.mark()
    setTalking(true)
    setCancelling(false)
    setTooShort(false)
    clearTimeout(capTimer.current)
    capTimer.current = setTimeout(() => {
      // Six seconds is plenty for a quizbowl answer; past that, send what
      // there is rather than holding the round hostage to a stuck finger.
      setTalking(false)
      setCancelling(false)
      sendAnswer()
    }, MAX_ANSWER_MS)
  }

  const talkMove = (e: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    if (talking) setCancelling(e.clientY - dragY.current > 60)
  }

  const talkUp = () => {
    if (!talking) return
    setTalking(false)
    clearTimeout(capTimer.current)
    if (cancelling) {
      // Drag-down cancelled; hold again to redo. That is the re-record.
      setCancelling(false)
      return
    }
    sendAnswer()
  }

  const fireItem = (itemId: string, targetId?: string) => {
    send({ t: 'act', act: 'useItem', data: { itemId, targetId } })
    setTargetFor(null)
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
    // wall, and telling a phone "reopening in a moment" when both finalists
    // have missed is a promise nothing will keep.
    dead: state?.round.candidates?.length === 0,
    finalistNames,
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
      <div class="player__lead-in">
        {armed && !barred && (
          <div
            key={round?.armedAt}
            class={open ? 'filament is-hot player__filament' : 'filament player__filament'}
            style={{ '--lead': `${lead}ms` }}
          />
        )}
      </div>

      {/* Seated, not yet armed. The buzzer below still says "Wait" for everyone,
          which is the one moment it means two different things — so say which
          one it is here rather than letting a finalist find out by pressing. */}
      {duel?.seated && !round?.candidates && (
        <div class="player__duel">
          <p class="eyebrow">Heads-up</p>
          <p class="player__faceoff">
            {seatedNames?.[0]} <span class="muted">vs</span> {seatedNames?.[1]}
          </p>
          <p class="muted">
            {duel.seated.includes(playerId ?? '')
              ? 'You’re one of them — your buzzer opens when the host arms'
              : 'You sit this one out'}
          </p>
        </div>
      )}

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
          {(duelRule.entry === 'vote' || duelRule.entry === 'both') &&
            (!canNominate ? (
              <p class="muted">You are not on a team yet — ask the host to put you on one.</p>
            ) : (
              <>
                {nominees.map((p) => {
                  const votes = duel.pool.find((e) => e.playerId === p.id)?.votes ?? []
                  return (
                    <button
                      key={p.id}
                      class={myVoteFor === p.id ? 'btn nom-btn is-mine' : 'btn nom-btn'}
                      // The identity rail, which in teams mode is the team's
                      // colour — the only thing on this list that says which
                      // side a name is on, and it matches the colour this
                      // phone's own name carries in the bar above.
                      style={{ '--id': state ? colorForPlayer(state, p.id) : undefined }}
                      onPointerDown={() => send({ t: 'act', act: 'duelVote', data: p.id })}
                    >
                      <span class="nom-btn__name">{p.name}</span>
                      <Votes voters={votes} />
                    </button>
                  )
                })}
                {/* The gesture is its own undo, which nobody guesses at — and a
                    vote you cannot take back is one people hesitate to cast. */}
                <p class="muted">
                  {myVoteFor
                    ? 'Tap them again to take your vote back'
                    : state?.mode === 'teams'
                      ? 'One vote each — your team picks its own'
                      : 'One vote each'}
                </p>
              </>
            ))}
        </div>
      )}

      {talk && !micOk.current ? (
        // No mic on this phone — denied, or the page is not on a secure origin,
        // which is every plain-http LAN address. Offering a button that cannot
        // record is worse than offering none: the player holds it, speaks, and
        // watches the window lapse into a neg with nothing to explain why.
        <div class="buzzer is-first buzzer--say">
          Say it out loud
          <span class="buzzer__sub">
            {round?.judge?.until
              ? <TalkCountdown until={round.judge.until} capSec={state?.answerWindowSec ?? 0} now={now} />
              : 'the host is judging this one'}
          </span>
        </div>
      ) : talk ? (
        <button
          class={`buzzer is-first buzzer--talk${talking ? ' is-talking' : ''}${cancelling ? ' is-cancelling' : ''}`}
          onPointerDown={talkDown}
          onPointerMove={talkMove}
          onPointerUp={talkUp}
          onPointerCancel={talkUp}
        >
          {talking
            ? (cancelling ? 'Let go to cancel' : 'Let go to send')
            : (tooShort ? 'Hold a little longer' : 'Hold to answer')}
          <span class="buzzer__sub">
            {talking && !cancelling
              ? 'drag down to cancel'
              : tooShort
                ? 'that was too short to hear'
                : round?.judge?.until
                  ? <TalkCountdown until={round.judge.until} capSec={state?.answerWindowSec ?? 0} now={now} />
                  : 'answer when ready'}
          </span>
        </button>
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
