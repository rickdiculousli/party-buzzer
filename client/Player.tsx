import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useFinale, useOpen, useSecondsLeft, useSocket, type SocketFixture } from './useSocket.ts'
import { Talk } from './Talk.tsx'
import { colorForPlayer, standings } from './ui.ts'
import { settleMs } from './Spoken.tsx'
import { PlayerDuel } from './PlayerDuel.tsx'
import { PlayerItems } from './PlayerItems.tsx'
import { finaleCalled, lastUp, momentOf, phoneOf } from '../shared/wall.ts'
import type { Mood } from '../shared/wall.ts'
import { QUIZ_REACT_LABEL, REACT_COOLDOWN_MS, type Award, type QuizReactKind, type State } from '../shared/protocol.ts'
import { scoreKey } from '../shared/scoring.ts'
import { MINIGAMES } from './minigames.tsx'
import { MinigameReady, readyShown } from './MinigameReady.tsx'
import { LETTERS } from '../shared/choice.ts'
import { GuessPad } from './GuessPad.tsx'
import { useClosestHold } from './ClosestLine.tsx'
import { scoresBeforeClosest } from '../shared/closest.ts'
import { ArrivalPhone } from './ArrivalPhone.tsx'
import { practiceLobbyId } from './arrival-feedback.ts'
import { usePracticeTime } from './usePractice.ts'
import { arrivalPresentation } from '../shared/arrival.ts'
import { Letters, ScoreChange, useFlip } from './fx.tsx'

const MOOD_CLASS: Record<Mood, string> = {
  waiting: 'is-waiting',
  open: 'is-open',
  placed: 'is-placed',
  first: 'is-first',
  barred: 'is-barred',
  verdict: 'is-verdict',
}

function useTold(round: State['round'] | undefined, instant: boolean): Award | undefined {
  const spoken = round?.spoken
  const spokenKey = spoken ? `${spoken.name}:${spoken.hit}:${spoken.transcript}` : ''
  const [toldKey, setToldKey] = useState('')
  useEffect(() => {
    if (!spokenKey || instant) return
    const t = setTimeout(() => setToldKey(spokenKey), settleMs(spoken!.transcript))
    return () => clearTimeout(t)
  }, [spokenKey, instant])
  return !spokenKey || instant || toldKey === spokenKey ? round?.award : undefined
}

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

export function StandingsDial({ state, playerId, held = false }: { state: State; playerId?: string | null; held?: boolean }) {
  const rows = standings(state)
  const list = useRef<HTMLOListElement>(null)
  const touched = useRef(-Infinity)
  useFlip(list)
  const mine = playerId ? scoreKey(state, playerId) : undefined
  const at = rows.findIndex((r) => r.key === mine)
  const order = rows.map((r) => r.key).join('|')
  useLayoutEffect(() => {
    const el = list.current
    if (!el || at < 0 || Date.now() - touched.current < 1000) return
    const row = el.children[at] as HTMLElement | undefined
    if (!row) return
    el.scrollTop = Math.max(0, row.offsetTop + row.offsetHeight / 2 - el.clientHeight / 2)
  }, [order, at])
  const ordinal = (i: number) =>
    i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : `${i + 1}th`

  return (
    <div class={held ? 'dial is-held' : 'dial'} aria-label="Standings" data-review-id="phone:standings">
      <ol class="dial__list" ref={list} onPointerDown={() => { touched.current = Date.now() }}>
        {rows.map((r, i) => (
          <li key={r.key} data-key={r.key} data-review-id={`phone:standing:${r.key}`} class={r.away ? 'dial__row fx-pop is-away' : 'dial__row fx-pop'} style={{ '--id': r.color }}>
            <span class={i < 3 ? `dial__rank rank rank--${i + 1}` : 'dial__rank rank'}>
              {ordinal(i)}
            </span>
            <span class="dial__name">{r.label}</span>
            {r.away && <span class="chip chip--away">away</span>}
            <ScoreChange class="dial__score readout" score={r.score} />
          </li>
        ))}
      </ol>
      <div class="dial__glass" aria-hidden="true" />
    </div>
  )
}

function VerdictTap() {
  useEffect(() => { navigator.vibrate?.([20, 70, 20, 70, 20]) }, [])
  return null
}

export type PlayerPreview = {
  socket: SocketFixture
  practiceNow?: number
  open: boolean
  pressed: boolean
}

function PickCountdown({ until, now }: { until: number; now: () => number }) {
  const left = useSecondsLeft(until, now)
  return <p class="player__countdown" data-review-id="phone:countdown" aria-label={`${left} seconds`}>{left}</p>
}

export function Player({ preview }: { preview?: PlayerPreview } = {}) {
  const { state, playerId, connected, now, send, minigameFrame, minigameAck, minigameTouches, practice } = useSocket('player', preview?.socket)
  const pulseNow = usePracticeTime(practice, practiceLobbyId(state), preview?.practiceNow)
  const [name, setName] = useState(() => localStorage.getItem('playerName') ?? '')
  const [ready, setReady] = useState(!!preview)
  const returning = !!localStorage.getItem('playerId')
  const audio = useRef<AudioContext | null>(null)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const micOk = useRef(false)

  useEffect(() => {
    if (preview) return
    if (!ready) return
    const acquire = async () => {
      try {
        wakeLock.current = await navigator.wakeLock?.request('screen')
      } catch {
      }
    }
    void acquire()
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void acquire()
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

  const holding = useClosestHold(round, !preview)
  const told = useTold(round, !!preview)
  const shownState = state && holding ? { ...state, scores: scoresBeforeClosest(state) } : state
  const score = key ? shownState?.scores[key] ?? 0 : 0
  const armed = round?.phase === 'ARMED' || round?.phase === 'COLLECTING'
  const pressed = !!round && pressedFor === round.attemptId && !!round.attemptId

  const opening = useOpen(round, now, () => {
    if (preview) return
    if (barred || frozen || spectator) return
    navigator.vibrate?.([40, 40, 40])
    blip(audio.current, 440)
  }, !preview)
  const open = preview?.open ?? opening.open

  useEffect(() => {
    if (preview) return
    if (!ready || !barred) return
    navigator.vibrate?.([120, 60, 120])
    blip(audio.current, 180, 260)
  }, [barred, ready, preview])

  useEffect(() => {
    if (preview || !ready || !connected || playerId) return
    send({ t: 'hello', role: 'player', name: name.trim() })
  }, [ready, connected, playerId, preview])

  const join = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    localStorage.setItem('playerName', trimmed)
    audio.current = new AudioContext()
    void audio.current.resume()
    void navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((s) => {
        micOk.current = true
        for (const t of s.getTracks()) t.stop()
      })
      .catch(() => {})
    if (returning) send({ t: 'hello', role: 'player', name: trimmed })
    setReady(true)
  }

  if (!ready) {
    return (
      <main class="join">
        <h1 class="join__mark">
          <Letters text="Party" class="fx-wave" />
          <br />
          <Letters text="Buzzer" class="fx-wave" />
        </h1>
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
    return <div class={readyShown(state, playerId) ? 'minigame-stage minigame-stage--ready' : 'minigame-stage'}>
      <Surface key={state.minigame.matchId} state={state} playerId={playerId} connected={connected} frame={minigameFrame} now={now} send={send} ack={minigameAck} touches={minigameTouches} />
      <MinigameReady state={state} playerId={playerId} send={send} />
    </div>
  }

  const choice = round?.kind === 'choice' || round?.kind === 'closest'
  const myPick = playerId ? round?.picks?.[playerId] : undefined
  const pick = (i: number) => {
    if (preview) return
    send({ t: 'act', act: 'pick', data: i })
    navigator.vibrate?.(30)
  }
  const myGuess = playerId ? round?.guesses?.[playerId] : undefined
  const guess = (n: number) => {
    if (preview) return
    send({ t: 'act', act: 'guess', data: n })
    navigator.vibrate?.(30)
  }

  const practiceBuzz = () => {
    const lobbyId = practiceLobbyId(state)
    if (preview || !connected || lobbyId === undefined) return
    send({ t: 'practiceBuzz', lobbyId })
    navigator.vibrate?.(60)
    blip(audio.current)
  }

  const [coolingUntil, setCoolingUntil] = useState(0)
  const cooling = coolingUntil > now()
  useEffect(() => {
    if (!cooling) return
    const id = setTimeout(() => setCoolingUntil(0), Math.max(0, coolingUntil - now()))
    return () => clearTimeout(id)
  }, [coolingUntil])
  const reactWith = (kind: QuizReactKind) => {
    if (preview || !connected || cooling) return
    send({ t: 'react', kind })
    setCoolingUntil(now() + REACT_COOLDOWN_MS + 250)
    navigator.vibrate?.(20)
  }

  const buzz = () => {
    if (preview) return
    if (!open || barred || pressed || frozen || spectator || choice) return
    if (!send({ t: 'buzz', at: now() })) return
    setPressedFor(round?.attemptId ?? '')
    navigator.vibrate?.(60)
    blip(audio.current)
  }

  const won = mine?.leader === true

  const reached = state
    ? momentOf(state, { open, settled: true, retired: true })
    : ('idle:welcome' as const)
  const moment = holding && reached === 'closest:reveal' ? 'closest:guessing' : reached
  const guessingClosed = holding || round?.truth !== undefined || (!!round?.guessing && now() >= round.guessing.closesAt)
  const place = shownState ? 1 + standings(shownState).filter((r) => r.score > score).length : undefined
  const finale = useFinale(state, now, !preview).step
  const called = place !== undefined && finaleCalled(finale, place)
  const dialHeld = moment === 'idle:finale' && finale !== 1
  const me = state?.players.find((p) => p.id === playerId)
  const { label, sub, mood, talk, tone, react } = phoneOf(moment, {
    frozen,
    barred,
    spectator,
    locked: round?.phase === 'LOCKED',
    scored: !!round?.award,
    dead: state?.round.buzzable?.length === 0,
    buzzableNames,
    won,
    deltaMs: mine?.deltaMs,
    pressed,
    armed,
    open,
    judging: !!round?.judge,
    place,
    called,
    next: round?.value,
    last: !!state && lastUp(state),
    pick: myPick,
    choices: round?.choices,
    correct: round?.correct,
    guess: myGuess,
    unit: round?.guessing?.unit,
    plain: !!round?.guessing?.plain,
    closed: guessingClosed,
    truth: round?.truth,
    paid: playerId ? round?.paid?.[playerId] : undefined,
    nearest: round?.nearest,
    value: round?.value,
    awardPoints: round?.award && !round.award.penalty ? round.award.points : undefined,
    told: told && told.name !== me?.name ? told : undefined,
  })

  const arrival = state ? arrivalPresentation(state) : null

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

      {arrival && state ? (
        <ArrivalPhone
          state={state}
          arrival={arrival}
          playerId={playerId}
          connected={connected}
          feedback={practice}
          pulseNow={pulseNow}
          onPractice={practiceBuzz}
        />
      ) : (
        <>
        {round?.image && <img class="player__image" data-review-id="phone:image" src={round.image} alt="" />}
        {(round?.fragments?.length || state?.typed) && (
          <p class="player__question" data-review-id="phone:question">{round?.fragments?.join(' ') || state?.typed}</p>
        )}

        {state && <PlayerDuel state={state} playerId={playerId} send={send} />}

        {moment === 'choice:picking' && round?.closesAt !== undefined && (
          <PickCountdown until={round.closesAt} now={now} />
        )}
        {moment === 'closest:guessing' && round?.guessing && (
          <PickCountdown until={round.guessing.closesAt} now={now} />
        )}

        {moment === 'choice:picking' && myPick === undefined && !frozen && !spectator ? (
          <div class="player__choices" data-review-id="phone:choices">
            {round!.choices!.map((c, i) => (
              <button key={i} class="choice__cell player__choice" onClick={() => pick(i)}>
                <span class="choice__letter">{LETTERS[i]}</span>
                <span class="choice__option">{c}</span>
              </button>
            ))}
          </div>
        ) : moment === 'closest:guessing' && myGuess === undefined && !guessingClosed && !frozen && !spectator ? (
          <GuessPad key={round?.questionId} unit={round?.guessing?.unit} plain={!!round?.guessing?.plain} onGuess={guess} />
        ) : talk ? (
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
            class={`buzzer ${MOOD_CLASS[mood]}${tone ? ` is-${tone}` : ''}`}
            onPointerDown={buzz}
            disabled={!open || barred || pressed || frozen || spectator || choice}
          >
            {mood === 'verdict' ? <span class="buzzer__name" style={{ '--len': Math.max(5, label.length) }}>{label}</span>
              : frozen ? <span class="buzzer__hit fx-wobble">{label}</span>
              : label}
            {sub && <span class="buzzer__sub">{sub}</span>}
          </button>
        )}

        {react && (
          <div class="react-row" data-review-id="phone:reactions">
            {(Object.keys(QUIZ_REACT_LABEL) as QuizReactKind[]).map((kind) => (
              <button key={kind} class="btn" disabled={cooling} onClick={() => reactWith(kind)}>
                {QUIZ_REACT_LABEL[kind]}
              </button>
            ))}
          </div>
        )}

        {mood === 'verdict' && !preview && <VerdictTap key={`${label}:${sub}`} />}

        {state && <PlayerItems state={state} playerId={playerId} send={send} />}
        </>
      )}

      {shownState && <StandingsDial state={shownState} playerId={playerId} held={dialHeld} />}
    </main>
  )
}
